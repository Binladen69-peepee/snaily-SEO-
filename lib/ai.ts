/**
 * Grok (xAI) client for Drafter and GEO Lab.
 *
 * Single point of contact with the model, mirroring how `lib/keywords/provider`
 * isolates the SERP source: nothing outside this file knows which model is in
 * use, so swapping provider later means editing one file.
 *
 * The endpoint is OpenAI-compatible, so the same shape would work against
 * another vendor by changing ENDPOINT and the key.
 */

import { estimateTokens, stageTimeoutMs } from "@/lib/ai-policy";

export class AiError extends Error {
  constructor(
    message: string,
    /** True when the operator can fix it by changing configuration. */
    readonly configurable = false,
  ) {
    super(message);
    this.name = "AiError";
  }

  /**
   * Whether the identical request could plausibly succeed later.
   *
   * The staged pipeline reads this to choose between backing off and marking a
   * stage permanently failed. Retrying a rejected API key spends the retry
   * budget and still fails, so the default is "no" and each subclass opts in.
   */
  get retryable(): boolean {
    return false;
  }

  /** Stable code for logs and the failure UI. Never carries provider text. */
  get code(): string {
    return "ai_error";
  }
}

/**
 * The provider said "not now".
 *
 * Carries its own reset estimate so a worker waits exactly as long as it was
 * told to rather than guessing, and separates a per-minute burst cap (worth
 * waiting out) from an exhausted daily allowance (not).
 */
export class AiRateLimit extends AiError {
  constructor(
    message: string,
    readonly retryAfterMs: number,
    readonly daily: boolean,
  ) {
    super(message, daily);
    this.name = "AiRateLimit";
  }

  override get retryable(): boolean {
    return !this.daily;
  }

  override get code(): string {
    return this.daily ? "ai_daily_quota" : "ai_rate_limit";
  }
}

/**
 * The configured model is gone.
 *
 * Its own class because this is the failure that took the Drafter down
 * silently once already: Groq retired llama-3.3-70b, the key stayed valid, and
 * every generation returned a 502 that named nothing. A fallback may only be
 * used when the project explicitly allows one, and the substitution is
 * recorded, so nobody has to guess which model wrote a draft.
 */
export class AiModelUnavailable extends AiError {
  constructor(
    message: string,
    readonly model: string,
  ) {
    super(message, true);
    this.name = "AiModelUnavailable";
  }

  override get code(): string {
    return "ai_model_unavailable";
  }
}

/**
 * The reply was cut off before the model finished writing.
 *
 * Separate from a rate limit because the fix is the opposite one: waiting
 * changes nothing, and the stage needs either more room or less to say. Marked
 * retryable so a one-off overrun is absorbed, with the cause named rather than
 * reported as an empty response.
 */
export class AiTruncated extends AiError {
  override get retryable(): boolean {
    return true;
  }

  override get code(): string {
    return "ai_truncated";
  }
}

/** Network trouble or a timeout. Worth another go. */
export class AiUnreachable extends AiError {
  override get retryable(): boolean {
    return true;
  }

  override get code(): string {
    return "ai_unreachable";
  }
}

/**
 * Environment lookup that ignores case.
 *
 * Windows treats `process.env` as case-insensitive, Linux does not — so a key
 * written as `GroK_Api_Key` works locally and silently vanishes on Vercel.
 * That failure is invisible until someone clicks Generate in production, so
 * the names are matched loosely here and the canonical spelling is documented.
 */
function env(...names: string[]): string {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [key, value] of Object.entries(process.env)) {
    if (wanted.has(key.toLowerCase()) && (value ?? "").trim() !== "") {
      return value!.trim();
    }
  }
  return "";
}

export function aiKey(): string {
  return env("GROK_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "AI_API_KEY");
}

export function aiEnabled(): boolean {
  return aiKey() !== "";
}

/**
 * Which vendor the key belongs to.
 *
 * "Grok" (xAI) and "Groq" (groq.com) are different companies whose names differ
 * by one letter, and their keys are trivially distinguishable: Groq issues
 * `gsk_…`, xAI issues `xai-…`. Detecting from the key rather than asking means
 * whichever one the operator actually has just works, instead of failing with
 * "incorrect API key" against the wrong endpoint.
 */
export type AiVendor = "groq" | "xai";

export function aiVendor(): AiVendor {
  const override = env("AI_VENDOR").toLowerCase();
  if (override === "groq" || override === "xai") return override;
  return aiKey().startsWith("gsk_") ? "groq" : "xai";
}

const ENDPOINTS: Record<AiVendor, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
};

/** Sensible default per vendor; both are overridable. */
/*
 * Groq retired llama-3.3-70b-versatile, and the Drafter failed outright on
 * every generation because of it: the key was valid, so nothing looked
 * misconfigured, and the only symptom was a 502 from the drafter route.
 * gpt-oss-120b is the largest general model the account can reach today.
 *
 * Overridable with GROK_MODEL, which is the real answer when this happens
 * again — vendors retire models faster than a deploy cycle.
 */
const DEFAULT_MODEL: Record<AiVendor, string> = {
  groq: "openai/gpt-oss-120b",
  xai: "grok-4",
};

export function aiVendorLabel(): string {
  return aiVendor() === "groq" ? "Groq" : "Grok";
}

/**
 * Model id. Overridable because both vendors retire and add models faster than
 * this app ships, and different keys have access to different tiers.
 */
export function aiModel(): string {
  const configured = env("GROK_MODEL", "GROQ_MODEL", "AI_MODEL");
  return configured || DEFAULT_MODEL[aiVendor()];
}

/**
 * Models that think before they answer.
 *
 * These spend part of the completion budget on hidden reasoning tokens and only
 * then write the reply. That matters here because the budget is small and
 * fixed: measured on this account, openai/gpt-oss-120b burns about 256 tokens
 * thinking about a 220-word intro, so a stage that asked for 400 got a reply
 * cut off mid-sentence, and one that asked for 700 on a harder prompt got an
 * empty string. The Drafter reported that as "Groq returned an empty response",
 * which is true and useless.
 */
const REASONING_MODELS = /gpt-oss|deepseek-r1|qwen3|^o[13]\b/i;

export function isReasoningModel(model: string): boolean {
  return REASONING_MODELS.test(model);
}

/**
 * How much thinking to pay for.
 *
 * "low" is the default because the difference is dramatic and free: the same
 * intro prompt spends 256 reasoning tokens at the provider default and 31 at
 * low, and the low-effort reply was the longer and better-formed of the two.
 * These are structured writing tasks against an explicit brief, not puzzles.
 * Overridable, including to "off" for a model that rejects the parameter.
 */
function reasoningEffort(): string {
  const configured = env("AI_REASONING_EFFORT").toLowerCase();
  if (["low", "medium", "high", "off", "none"].includes(configured)) {
    return configured;
  }
  return "low";
}

/** Longest a rate-limit wait may be before it threatens the request budget. */
const MAX_RETRY_WAIT_MS = 15_000;

/**
 * How long the provider says to wait, in milliseconds.
 *
 * Both vendors send `retry-after` (seconds); Groq also sends a reset hint like
 * "7.66s" or "210ms". Zero means "do not retry".
 */
/**
 * True when the 429 is an exhausted *daily* allowance rather than a burst cap.
 *
 * Groq words this as "tokens per day (TPD)"; xAI and others use "daily". A
 * burst cap clears in seconds and is worth retrying; a daily cap is not.
 */
function isDailyQuota(body: string): boolean {
  return /per day|\bTPD\b|\bRPD\b|daily (?:limit|quota|token)/i.test(body);
}

/** The provider's own reset estimate, e.g. "1h56m6.432s" → "1h56m". */
/**
 * The reset window as milliseconds, for a caller that wants to wait it out.
 *
 * Same source as `resetHint`, parsed rather than formatted. A daily allowance
 * that comes back in nine minutes is a wait, not a failure, and the pipeline
 * can only treat it as one if it knows how long.
 */
function resetMs(body: string): number {
  const match = /try again in\s+([\dhms.]+)/i.exec(body);
  if (!match?.[1]) return 0;

  let total = 0;
  for (const part of match[1].matchAll(/([\d.]+)\s*(h|m|s|ms)/gi)) {
    const value = Number.parseFloat(part[1] ?? "0");
    const unit = (part[2] ?? "s").toLowerCase();
    if (!Number.isFinite(value)) continue;
    total +=
      unit === "h"
        ? value * 3_600_000
        : unit === "m"
          ? value * 60_000
          : unit === "ms"
            ? value
            : value * 1_000;
  }
  return Math.round(total);
}

function resetHint(body: string): string | null {
  const match = /try again in\s+([\dhms.]+)/i.exec(body);
  if (!match?.[1]) return null;
  // Drop fractional seconds — "1h56m6.432s" is noise at this scale.
  const trimmed = match[1].replace(/(\d+)\.\d+s/, "$1s");
  return /^(\d+h)?(\d+m)?/.exec(trimmed)?.[0] || trimmed;
}

function retryDelayMs(res: Response): number {
  const candidates = [
    res.headers.get("retry-after"),
    res.headers.get("x-ratelimit-reset-tokens"),
    res.headers.get("x-ratelimit-reset-requests"),
  ];

  for (const value of candidates) {
    if (value === null || value.trim() === "") continue;

    const match = /^([\d.]+)\s*(ms|s|m)?$/i.exec(value.trim());
    if (!match) continue;

    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) continue;

    const unit = (match[2] ?? "s").toLowerCase();
    const ms =
      unit === "ms" ? amount : unit === "m" ? amount * 60_000 : amount * 1000;
    if (ms <= 0) continue;

    return Math.min(Math.ceil(ms) + 500, MAX_RETRY_WAIT_MS);
  }

  return 0;
}

type ChatResponse = {
  choices?: {
    message?: { content?: string; reasoning?: string };
    finish_reason?: string;
  }[];
  error?: { message?: string } | string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type AiUsage = {
  input: number;
  output: number;
  total: number;
  /** False when the provider did not report usage and these are estimates. */
  measured: boolean;
};

export type AiCompletion = {
  text: string;
  usage: AiUsage;
  provider: AiVendor;
  model: string;
  durationMs: number;
};

export type CompleteOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Wait out a burst rate limit inside this request.
   *
   * Off by default for staged work: a job that owns its own retry schedule
   * should not also be sleeping inside the HTTP call, because that time comes
   * out of the invocation budget it needs for the next stage.
   */
  retryOnRateLimit?: boolean;
  /** Overrides the configured model, for an explicitly allowed fallback. */
  model?: string;
};

/**
 * One completion. Returns the assistant's text.
 *
 * Errors are translated into something an operator can act on — a wrong model
 * name and an expired key produce very different fixes, and the raw xAI
 * message is passed through so the reason is never guesswork.
 */
export async function completeDetailed(
  opts: CompleteOptions,
): Promise<AiCompletion> {
  const {
    system,
    user,
    maxTokens = 2000,
    temperature = 0.7,
    retryOnRateLimit = false,
  } = opts;
  const model = opts.model ?? aiModel();
  const startedAt = Date.now();
  const key = aiKey();
  if (key === "") {
    throw new AiError(
      "No AI key configured. Set GROK_API_KEY in the environment to enable AI writing.",
      true,
    );
  }

  const vendor = aiVendorLabel();

  let res: Response;
  try {
    res = await fetch(ENDPOINTS[aiVendor()], {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        /*
         * Only sent to models that have the setting. A model without it
         * rejects the whole request as an unknown parameter, which would turn
         * a working configuration into a total outage on the next model swap.
         */
        ...(aiVendor() === "groq" &&
        isReasoningModel(model) &&
        !["off", "none"].includes(reasoningEffort())
          ? { reasoning_effort: reasoningEffort() }
          : {}),
      }),
      signal: AbortSignal.timeout(stageTimeoutMs()),
    });
  } catch {
    throw new AiUnreachable(
      `Could not reach the ${vendor} API. Check the network and try again.`,
    );
  }

  const payload = (await res.json().catch(() => ({}))) as ChatResponse;

  const raw =
    typeof payload.error === "string"
      ? payload.error
      : (payload.error?.message ?? "");

  if (!res.ok) {
    // A rejected key is a configuration problem whatever status it arrives
    // with — xAI returns 400 for it, not 401, and that difference decides
    // whether the UI tells the operator to go and fix the key.
    if (/incorrect api key|invalid api key|api key/i.test(raw)) {
      throw new AiError(
        `${vendor} rejected the API key — ${raw} (this key looks like ${
          aiKey().startsWith("gsk_") ? "a Groq key" : "an xAI key"
        }; the app picked the ${vendor} endpoint from its prefix.)`,
        true,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new AiError(
        `${vendor} rejected the API key${raw === "" ? "" : ` — ${raw}`}`,
        true,
      );
    }
    // Groq's free tier reports oversized prompts as a model error
    // ("Request too large for model `llama-3.3-70b-versatile`… TPM"), which
    // would otherwise send the operator to change GROK_MODEL.
    if (
      /request too large|tokens per minute|\bTPM\b|please reduce your message size/i.test(
        raw,
      )
    ) {
      /*
       * The provider words this as a size problem, but on a metered tier the
       * cause is almost always the per-minute token allowance: the identical
       * request succeeds a minute later, untouched. "Too large" sent an
       * operator off to shorten a draft that was never the problem, so it is
       * reported as what it is and handed a wait long enough to clear.
       */
      throw new AiRateLimit(
        `${vendor} has no tokens left this minute — the limit counts the prompt and the reply together.`,
        30_000,
        false,
      );
    }
    // Checked before the model branch: a rate-limit body names the model
    // ("Rate limit reached for model `llama-3.3-70b-versatile`…"), which would
    // otherwise be reported as an unusable model and send the operator off to
    // change a setting that is not the problem.
    if (res.status === 429 || /rate limit|quota|too many requests/i.test(raw)) {
      // Free tiers meter tokens per minute, and a multi-stage job like GEO
      // drafting spends that budget in a few seconds. One short wait recovers
      // the common case; anything longer would risk the serverless ceiling, so
      // it is reported rather than retried again.
      const wait = retryDelayMs(res);
      if (retryOnRateLimit && wait > 0 && !isDailyQuota(raw)) {
        await new Promise((r) => setTimeout(r, wait));
        return completeDetailed({ ...opts, retryOnRateLimit: false });
      }

      /*
       * A per-minute cap and an exhausted daily allowance both arrive as 429,
       * but the fix is completely different. Telling someone to "wait a moment"
       * when their quota resets in two hours sends them to retry repeatedly for
       * nothing, so the two are separated and the daily case names the actual
       * remedy instead of pasting the provider's billing pitch.
       */
      if (isDailyQuota(raw)) {
        const resets = resetHint(raw);
        throw new AiRateLimit(
          /*
           * No model is named as the remedy. The previous wording recommended
           * llama-3.1-8b-instant, which this account cannot even reach any
           * more - a suggestion that sends someone to configure something
           * impossible is worse than none, and which models a key can use
           * changes without warning.
           */
          `Daily ${vendor} token allowance used up for "${model}"${
            resets === null ? "" : `, resets in ${resets}`
          }. Wait for the reset, or set GROK_MODEL to another model your key can reach.`,
          // Carried so a background job can wait the window out instead of
          // throwing the author's article away over a quota that refills.
          resetMs(raw),
          true,
        );
      }

      throw new AiRateLimit(
        `${vendor} rate limit reached — too many requests in a short window.`,
        wait > 0 ? wait : 10_000,
        false,
      );
    }
    if (res.status === 404 || /model/i.test(raw)) {
      throw new AiModelUnavailable(
        `${vendor} could not use the model "${model}". Set GROK_MODEL to one your key can access${raw === "" ? "" : ` — ${raw}`}`,
        model,
      );
    }
    throw new AiError(
      raw === ""
        ? `${vendor} returned ${String(res.status)}.`
        : `${vendor} error: ${raw}`,
    );
  }

  const choice = payload.choices?.[0];
  const text = choice?.message?.content?.trim() ?? "";

  /*
   * Empty content with a length stop is a reasoning model that spent the whole
   * completion budget thinking. Naming it that way is the difference between
   * an operator raising AI_MAX_OUTPUT_TOKENS and an operator rewriting a prompt
   * that was never the problem.
   */
  if (text === "" && choice?.finish_reason === "length") {
    throw new AiTruncated(
      `${vendor} used the whole reply budget on "${model}" before writing anything.` +
        (isReasoningModel(model)
          ? " This model reasons before it answers; lower AI_REASONING_EFFORT or raise AI_MAX_OUTPUT_TOKENS."
          : " Raise AI_MAX_OUTPUT_TOKENS."),
    );
  }

  if (choice?.finish_reason === "length" && text !== "") {
    throw new AiTruncated(
      `${vendor} cut the reply off at the token limit, so the section is unfinished.`,
    );
  }

  if (text === "") {
    throw new AiTruncated(`${vendor} returned an empty response.`);
  }

  /*
   * Real usage when the provider reports it, an estimate when it does not, and
   * the difference is recorded rather than smoothed over: a cost figure nobody
   * can trace back to a bill should not be shown to a client as though it were
   * one.
   */
  const measured = typeof payload.usage?.prompt_tokens === "number";
  const input = payload.usage?.prompt_tokens ?? estimateTokens(system + user);
  const output = payload.usage?.completion_tokens ?? estimateTokens(text);

  return {
    text,
    usage: {
      input,
      output,
      total: payload.usage?.total_tokens ?? input + output,
      measured,
    },
    provider: aiVendor(),
    model,
    durationMs: Date.now() - startedAt,
  };
}

/** Text-only completion. The original signature, kept for existing callers. */
export async function complete(
  system: string,
  user: string,
  maxTokens = 2000,
  /** One bounded wait-and-retry after a burst rate limit. */
  retryAfterLimit = true,
  temperature = 0.7,
): Promise<string> {
  const result = await completeDetailed({
    system,
    user,
    maxTokens,
    temperature,
    retryOnRateLimit: retryAfterLimit,
  });
  return result.text;
}

/** Model-facing rules shared by every generation. */
function systemPrompt(keyword: string, terms: string[]): string {
  return [
    "You are an expert SEO content writer helping draft a blog article.",
    `The article targets the search keyword: "${keyword}".`,
    terms.length > 0
      ? `Work these related terms in naturally where they fit: ${terms.slice(0, 25).join(", ")}.`
      : "",
    "Rules:",
    "- Write in Markdown. Use ## for section headings and ### for sub-sections.",
    // The model has no way to know which image URLs exist, so asking it for
    // one produces a plausible link that 404s. It marks the spot instead and
    // the server swaps in a real, licensed image.
    "- Illustrate the article. Put `[[image: short description of the picture]]` alone on its own line, directly under the heading it belongs to. Never write an image URL yourself — the marker is replaced with a real licensed photo.",
    "- Include one image for each major section you write, and at least one image in every response that contains a heading.",
    "- Describe the picture in plain, concrete nouns, e.g. `[[image: sliced cucumbers in a bowl]]`, not abstract phrases.",
    "- Never output the article's H1 title; that is set separately.",
    "- Write for a human reader. No filler, no repetition, no invented statistics.",
    "- Do not wrap the response in a code fence.",
    "- Return only the content itself, with no preamble or commentary.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export type GenerateInput = {
  instruction: string;
  title: string;
  keyword: string;
  /** Target terms the article should cover. */
  terms: string[];
  /** What is already written, so the model continues rather than repeats. */
  existing: string;
  /** Headings the ranking pages share, used for outline generation. */
  headings?: string[];
  /** Questions the ranking pages answer, so the draft covers them too. */
  questions?: string[];
};

/**
 * Runs one AI Writer instruction and returns Markdown.
 *
 * Existing content is truncated: the tail is what matters for continuity, and
 * sending a 3,000-word draft on every request would be slow and wasteful.
 */
export async function generate(input: GenerateInput): Promise<string> {
  const context: string[] = [`Article title: ${input.title}`];

  if (input.headings && input.headings.length > 0) {
    context.push(
      `Sections the top-ranking pages cover: ${input.headings.slice(0, 15).join("; ")}`,
    );
  }

  // The research already knows what readers ask about this topic. Handing the
  // model those questions is the difference between generic filler and a draft
  // that answers what people actually search for.
  if (input.questions && input.questions.length > 0) {
    context.push(
      `Questions readers ask about this topic — answer the relevant ones in the body:\n${input.questions
        .slice(0, 12)
        .map((q) => `- ${q}`)
        .join("\n")}`,
    );
  }

  const existing = input.existing.trim();
  if (existing !== "") {
    const tail = existing.length > 4000 ? existing.slice(-4000) : existing;
    context.push(
      `Content written so far (continue from this, do not repeat it):\n${tail}`,
    );
  } else {
    context.push("Nothing has been written yet.");
  }

  context.push(`Instruction: ${input.instruction}`);

  return complete(
    systemPrompt(input.keyword, input.terms),
    context.join("\n\n"),
    2500,
  );
}

/**
 * Splits a Markdown response into reviewable blocks.
 *
 * The editor shows each block with its own Accept / Reject, matching the
 * KeySearch review flow, so a good paragraph can be kept even when the one
 * beside it is wrong.
 */
export function toBlocks(markdown: string): string[] {
  return markdown
    .replace(/^```(?:markdown)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== "");
}
