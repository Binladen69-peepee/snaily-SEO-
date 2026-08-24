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
 * Groq meters this per minute and per model: the retired llama-3.3-70b allowed
 * 12,000, gpt-oss-120b allows 8,000. The staged pipeline stays well under it
 * on purpose so two stages can run inside the same minute.
 */
export function tpmBudget(): number {
  return num("AI_TPM_BUDGET", 7_600);
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
 * minus the thinking. Measured at 31 tokens on low effort and 256 on the
 * provider default; the reserve covers both.
 */
export function reasoningReserve(): number {
  return num("AI_REASONING_RESERVE", 300);
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
