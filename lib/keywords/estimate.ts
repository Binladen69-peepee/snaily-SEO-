import type { Keyword, SearchIntent } from "@/lib/keywords/types";

/**
 * Deterministic estimates for metrics no free/live source gives us.
 *
 * SerpApi returns real SERPs but not search volume, CPC or link counts. Rather
 * than showing blanks, those fields are estimated here from signals we do have
 * (phrase length, intent, ranking position). Estimates are deterministic, so a
 * keyword shows the same numbers everywhere in the app.
 *
 * Anything produced here is an estimate and the UI must badge it as one.
 */

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // FNV-1a alone barely changes when only the last character differs, and seeds
  // here are sequential (`…|b0`, `…|b1`). Finalise so one character avalanches.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export function rand(seed: string): number {
  return hash(seed) / 4294967295;
}

export function randInt(seed: string, min: number, max: number): number {
  return Math.floor(min + rand(seed) * (max - min + 1));
}

const QUESTION_PREFIXES = [
  "what is", "how to", "why is", "when to", "where to", "who needs",
  "is", "does", "can you", "how much does", "how long does", "what are the best",
];
const TRANSACTIONAL = ["buy", "price", "pricing", "cheap", "order", "discount"];
const COMMERCIAL = [
  "best", "top", "review", "reviews", "vs", "comparison",
  "alternatives", "software", "tools", "services", "companies",
];
const NAVIGATIONAL = ["login", "sign in", "download", "app", "official"];

export function detectIntent(keyword: string): SearchIntent {
  const k = keyword.toLowerCase();
  if (QUESTION_PREFIXES.some((p) => k.startsWith(p))) return "informational";
  if (TRANSACTIONAL.some((t) => k.includes(t))) return "transactional";
  if (NAVIGATIONAL.some((n) => k.includes(n))) return "navigational";
  if (COMMERCIAL.some((c) => k.includes(c))) return "commercial";
  return "informational";
}

export { QUESTION_PREFIXES };

/** Longer, more specific phrases get less volume and are easier to rank. */
export function estimateKeyword(
  phrase: string,
  country: string,
  /** Real total-results count from the SERP, when available. */
  totalResults?: number,
): Keyword {
  const seed = `${phrase}|${country}`;
  const words = phrase.trim().split(/\s+/).length;

  const base = randInt(`${seed}|v`, 200, 74000);
  const volume = Math.max(10, Math.round(base / Math.pow(words, 1.35) / 10) * 10);

  const intent = detectIntent(phrase);

  /*
   * Difficulty for a keyword we have no SERP for.
   *
   * Volume is log-scaled: the jump from 100 to 1,000 searches means far more
   * for competitiveness than 50,000 to 51,000. The length discount is kept
   * small — an earlier linear volume term plus a steep per-word penalty went
   * negative for any phrase of four or more words, so every long-tail keyword
   * clamped to the floor and the whole list rendered as "Very Easy".
   */
  const volumeFactor = Math.min(1, Math.log10(Math.max(volume, 10)) / 5);
  const lengthPenalty = Math.min(0.28, (words - 1) * 0.045);
  const noise = rand(`${seed}|d`) * 0.18 - 0.09;
  const difficulty = Math.min(
    92,
    Math.max(
      8,
      Math.round((0.3 + volumeFactor * 0.55 - lengthPenalty + noise) * 100),
    ),
  );

  const intentMultiplier =
    intent === "transactional" ? 3.1 : intent === "commercial" ? 2.2 : 1;
  const cpc = Math.round(rand(`${seed}|c`) * 7.5 * intentMultiplier * 100) / 100;

  const competition =
    Math.round(Math.min(1, (difficulty / 100) * 0.7 + rand(`${seed}|k`) * 0.3) * 100) / 100;

  const amplitude = rand(`${seed}|a`) * 0.35;
  const offset = randInt(`${seed}|o`, 0, 11);
  const trend = Array.from({ length: 12 }, (_, i) => {
    const wave = Math.sin(((i + offset) / 12) * Math.PI * 2) * amplitude;
    const jitter = rand(`${seed}|t${String(i)}`) * 0.12 - 0.06;
    return Math.max(10, Math.round((volume * (1 + wave + jitter)) / 10) * 10);
  });

  return {
    keyword: phrase,
    volume,
    difficulty,
    cpc,
    competition,
    trend,
    intent,
    metricsSource: "estimated",
    // Prefer the real figure from the SERP when the provider supplied one.
    results: totalResults ?? randInt(`${seed}|r`, 120_000, 89_000_000),
  };
}

/**
 * Difficulty for a keyword whose first page we actually fetched.
 *
 * Far better than guessing from volume: it reads the strength of the pages a
 * new article would have to displace. Used for the analysed keyword, where one
 * SERP call has already been spent; the idea list keeps the volume-based
 * estimate above, since a SERP call per row would exhaust the quota.
 */
export function difficultyFromSerp(
  serp: { pageAuthority: number; domainAuthority: number }[],
): number | null {
  if (serp.length === 0) return null;

  const mean = (values: number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;

  const avgPage = mean(serp.map((r) => r.pageAuthority));
  const avgDomain = mean(serp.map((r) => r.domainAuthority));

  // The page you must beat matters slightly more than the site behind it.
  return Math.max(5, Math.min(98, Math.round(avgPage * 0.5 + avgDomain * 0.45)));
}

/** Authority-style numbers for a ranking result, derived from its position. */
export function estimateSerpMetrics(domain: string, position: number) {
  const seed = `${domain}|${String(position)}`;

  const domainAuthority = Math.max(
    12,
    Math.min(98, Math.round(88 - position * 4 + (rand(`${seed}|a`) * 26 - 13))),
  );
  const pageAuthority = Math.max(
    8,
    Math.min(95, Math.round(domainAuthority - randInt(`${seed}|pa`, 4, 28))),
  );

  return {
    pageAuthority,
    domainAuthority,
    pageLinkingDomains: randInt(`${seed}|pld`, 0, 2_600),
    domainLinkingDomains: randInt(`${seed}|dld`, 2_000, 7_500_000),
    authority: Math.max(
      5,
      Math.min(100, domainAuthority + randInt(`${seed}|au`, -8, 8)),
    ),
    backlinks: randInt(`${seed}|b`, 40, 240_000),
  };
}
