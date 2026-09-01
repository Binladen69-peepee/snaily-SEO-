/**
 * One place that decides how big an AI request may be and how hard to retry.
 *
 * These numbers used to live inside `lib/drafter/generate.ts` as a private
 * helper, which meant the staged pipeline could not see them and a second copy
 * appeared the moment a second caller needed one. A wrong budget here does not
 * degrade gracefully — the provider rejects the whole request — so it is worth
 * having exactly one answer, and an operator-settable one, because the ceiling
 * belongs to the model and models get retired.
 */

/** Characters per token, near enough for budgeting English prose. */
const CHARS_PER_TOKEN = 4;

/** Overhead the provider adds per message beyond the text itself. */
const MESSAGE_OVERHEAD_TOKENS = 24;

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = Number(raw ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Tokens a single request may spend, prompt plus completion.
 *
 * Groq meters this per minute, and every model on this account reports the
 * same ceiling: `x-ratelimit-limit-tokens: 8000`, checked against gpt-oss-120b
 * and both Qwen builds. 7,600 was a guess made before anyone read that header
 * and it cost 5% of the only resource the pipeline is actually short of.
 *
 * The remaining margin is real and stays: our prompt estimate counts
 * characters and divides by four, which runs under the provider's own count,
 * and spending to the last token means meeting the difference as a 429.
 */
export function tpmBudget(): number {
  return num("AI_TPM_BUDGET", 8_000);
}

/** Ceiling on any single completion, before the prompt is subtracted. */
export function maxOutputTokens(): number {
  return num("AI_MAX_OUTPUT_TOKENS", 3_000);
}

/** How many times one stage may re-attempt a retryable provider failure. */
export function retryLimit(): number {
  return num("AI_RETRY_LIMIT", 3);
}

/**
 * Extra completion room for a model that thinks before it writes.
 *
 * A reasoning model's hidden tokens come out of the same allowance as its
 * reply, so asking for exactly the length wanted produces exactly that length
 * minus the thinking.
 *
 * How much thinking varies enormously between models, and 300 was measured on
 * gpt-oss-120b — 31 tokens at low effort, 256 at the provider default. Handed
 * the identical section prompt at the same low effort, qwen3.8-27b spent 457.
 * A reserve smaller than the thinking is not a slow call, it is a truncated
 * one: the reply is cut off, the stage retries, and the retry re-sends the
 * whole prompt. On a fixed per-minute allowance that turns one call into
 * three, which is why this is sized per model rather than once.
 */
const RESERVE_BY_MODEL: { pattern: RegExp; reserve: number }[] = [
  // Measured: 457 reasoning tokens on a section prompt at low effort.
  { pattern: /qwen3/i, reserve: 700 },
  // Measured: 22 at low effort, 256 at the provider default.
  { pattern: /gpt-oss/i, reserve: 300 },
];

export function reasoningReserve(model = ""): number {
  const configured = Number(process.env.AI_REASONING_RESERVE ?? "");
  if (Number.isFinite(configured) && configured > 0) return configured;

  for (const { pattern, reserve } of RESERVE_BY_MODEL) {
    if (pattern.test(model)) return reserve;
  }
  return 300;
}

/** Wall clock a single stage may occupy before it is abandoned. */
export function stageTimeoutMs(): number {
  return num("AI_STAGE_TIMEOUT", 50_000);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Largest completion that still fits under the per-request ceiling.
 *
 * Returns 0 when the prompt alone has eaten the budget, which the caller must
 * treat as "shrink the prompt" rather than "ask for fewer tokens" — there is no
 * completion size that rescues an oversized prompt.
 */
export function fitMaxTokens(
  system: string,
  user: string,
  desired: number,
  floor = 400,
): number {
  const prompt =
    estimateTokens(system) + estimateTokens(user) + MESSAGE_OVERHEAD_TOKENS;
  const room = tpmBudget() - prompt;
  if (room < floor) return 0;
  return Math.max(floor, Math.min(desired, maxOutputTokens(), room));
}

/** Prompt characters still available if the completion needs `output` tokens. */
export function promptCharBudget(output: number): number {
  return Math.max(
    0,
    (tpmBudget() - output - MESSAGE_OVERHEAD_TOKENS) * CHARS_PER_TOKEN,
  );
}

/** Trim to a character budget on a word boundary, marking the cut. */
export function clip(value: string, max: number): string {
  const v = value.trim() === "" ? "(empty)" : value.trim();
  if (v.length <= max) return v;
  return `${v.slice(0, max).replace(/\s+\S*$/, "")}\n…[truncated]`;
}
