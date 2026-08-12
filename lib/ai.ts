/**
 * Grok (xAI) client for the Content Assistant.
 *
 * Single point of contact with the model, mirroring how `lib/keywords/provider`
 * isolates the SERP source: nothing outside this file knows which model is in
 * use, so swapping provider later means editing one file.
 *
 * The endpoint is OpenAI-compatible, so the same shape would work against
 * another vendor by changing ENDPOINT and the key.
 */

/** Long-form sections take a while; well under Vercel's 60s ceiling. */
const TIMEOUT_MS = 55_000;

export class AiError extends Error {
  constructor(
    message: string,
    /** True when the operator can fix it by changing configuration. */
    readonly configurable = false,
  ) {
    super(message);
    this.name = "AiError";
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
const DEFAULT_MODEL: Record<AiVendor, string> = {
  groq: "llama-3.3-70b-versatile",
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

/** Longest a rate-limit wait may be before it threatens the request budget. */
const MAX_RETRY_WAIT_MS = 15_000;

/**
 * How long the provider says to wait, in milliseconds.
 *
 * Both vendors send `retry-after` (seconds); Groq also sends a reset hint like
 * "7.66s" or "210ms". Zero means "do not retry".
 */
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
  choices?: { message?: { content?: string } }[];
  error?: { message?: string } | string;
};

/**
 * One completion. Returns the assistant's text.
 *
 * Errors are translated into something an operator can act on — a wrong model
 * name and an expired key produce very different fixes, and the raw xAI
 * message is passed through so the reason is never guesswork.
 */
export async function complete(
  system: string,
  user: string,
  maxTokens = 2000,
  /** Internal: one bounded retry after a rate limit. */
  retryAfterLimit = true,
): Promise<string> {
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
        model: aiModel(),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AiError(
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
      if (retryAfterLimit && wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
        return complete(system, user, maxTokens, false);
      }
      throw new AiError(
        `${vendor} rate limit reached. Wait a moment and retry${raw === "" ? "" : ` — ${raw}`}`,
      );
    }
    if (res.status === 404 || /model/i.test(raw)) {
      throw new AiError(
        `${vendor} could not use the model "${aiModel()}". Set GROK_MODEL to one your key can access${raw === "" ? "" : ` — ${raw}`}`,
        true,
      );
    }
    throw new AiError(
      raw === ""
        ? `${vendor} returned ${String(res.status)}.`
        : `${vendor} error: ${raw}`,
    );
  }

  const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (text === "") {
    throw new AiError(`${vendor} returned an empty response. Try rephrasing.`);
  }

  return text;
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
