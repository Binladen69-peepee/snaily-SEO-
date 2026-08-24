/**
 * The Deep Dive tabs: Questions, Purchase Intent, Comparison, Local, Long Tail.
 *
 * These are filters over one result set, not separate searches, so every tab
 * shows a count and switching between them costs nothing. A keyword can sit in
 * several at once — "best affirmation cards for women near me" is purchase
 * intent, local and long tail — which is how KeySearch behaves too, and why the
 * tab counts do not add up to the total.
 *
 * The word lists are deliberately conservative. A tab that quietly includes
 * near-misses is worse than one that shows a smaller, trustworthy number,
 * because the whole point of the tab is to skip reading 699 rows.
 */

import type { Keyword } from "@/lib/keywords/types";

export const DEEP_DIVE_TABS = [
  "all",
  "questions",
  "purchase",
  "comparison",
  "local",
  "longtail",
] as const;

export type DeepDiveTab = (typeof DEEP_DIVE_TABS)[number];

export const TAB_LABEL: Record<DeepDiveTab, string> = {
  all: "All Keywords",
  questions: "Questions",
  purchase: "Purchase Intent",
  comparison: "Comparison",
  local: "Local",
  longtail: "Long Tail",
};

export const TAB_NOTE: Record<DeepDiveTab, string> = {
  all: "Every idea returned by the selected source.",
  questions: "Phrased as a question — the ones an FAQ or a how-to should answer.",
  purchase: "Buying language: price, best, review, deal, where to buy.",
  comparison: "Weighing options: vs, versus, alternative, difference between.",
  local: "Tied to a place: near me, nearby, delivery, opening hours.",
  longtail: "Four words or more. Lower volume, far easier to rank for.",
};

/** Question openers, plus anything actually punctuated as a question. */
const QUESTION =
  /^(what|what's|whats|how|how's|why|when|where|which|who|whose|whom|is|are|was|were|do|does|did|can|could|should|would|will|shall|has|have|had|am|may|might)\b/i;

/**
 * Buying language.
 *
 * "best" and "top" earn their place: they are the strongest commercial-
 * investigation signal in search and the reason review posts exist. "free" is
 * here too — it is a purchase decision, just one that ends in not paying.
 */
const PURCHASE =
  /\b(buy|buying|purchase|order|price|prices|pricing|cost|costs|cheap|cheapest|affordable|budget|discount|discounts|coupon|coupons|deal|deals|sale|for sale|shop|shopping|store|stores|review|reviews|rated|best|top|free|shipping|delivery|subscription|refurbished|wholesale|bulk)\b/i;

/** Weighing one option against another. */
const COMPARISON =
  /(\bvs\b|\bv\.?s\.?\b|\bversus\b|\bcompared? (?:to|with)\b|\bcomparison\b|\balternatives?\b|\bsubstitutes?\b|\bdifference between\b|\bor\b.*\bwhich\b|\bbetter than\b|\bwhich is better\b)/i;

/**
 * Place-bound intent.
 *
 * "in <somewhere>" is left out on purpose: it matches "in the oven", "in a
 * blender" and most of a recipe site's vocabulary, which would make the tab
 * useless on exactly the site this app is built for.
 */
const LOCAL =
  /\b(near me|nearby|near by|close to me|in my area|local|locally|around me|delivery|deliver to|open now|opening hours|opening times|hours today|directions to|store near|shop near|walking distance)\b/i;

/** Four words or more, the usual long-tail threshold. */
export const LONG_TAIL_WORDS = 4;

export function wordCount(keyword: string): number {
  return keyword.trim().split(/\s+/).filter(Boolean).length;
}

export function isQuestion(keyword: string): boolean {
  const k = keyword.trim();
  return k.endsWith("?") || QUESTION.test(k);
}

export function isPurchase(keyword: string): boolean {
  return PURCHASE.test(keyword);
}

export function isComparison(keyword: string): boolean {
  return COMPARISON.test(keyword);
}

export function isLocal(keyword: string): boolean {
  return LOCAL.test(keyword);
}

export function isLongTail(keyword: string): boolean {
  return wordCount(keyword) >= LONG_TAIL_WORDS;
}

const MATCHERS: Record<DeepDiveTab, (keyword: string) => boolean> = {
  all: () => true,
  questions: isQuestion,
  purchase: isPurchase,
  comparison: isComparison,
  local: isLocal,
  longtail: isLongTail,
};

export function matchesTab(keyword: string, tab: DeepDiveTab): boolean {
  return MATCHERS[tab](keyword);
}

export function filterByTab<T extends { keyword: string }>(
  rows: T[],
  tab: DeepDiveTab,
): T[] {
  return tab === "all" ? rows : rows.filter((r) => MATCHERS[tab](r.keyword));
}

export type TabCounts = Record<DeepDiveTab, number>;

/** One pass over the rows for every tab, so the header renders in one go. */
export function countTabs(rows: { keyword: string }[]): TabCounts {
  const counts: TabCounts = {
    all: rows.length,
    questions: 0,
    purchase: 0,
    comparison: 0,
    local: 0,
    longtail: 0,
  };

  for (const row of rows) {
    if (isQuestion(row.keyword)) counts.questions += 1;
    if (isPurchase(row.keyword)) counts.purchase += 1;
    if (isComparison(row.keyword)) counts.comparison += 1;
    if (isLocal(row.keyword)) counts.local += 1;
    if (isLongTail(row.keyword)) counts.longtail += 1;
  }

  return counts;
}

/** Every tab a keyword belongs to, for the row's own badges. */
export function tabsFor(keyword: string): DeepDiveTab[] {
  return DEEP_DIVE_TABS.filter(
    (tab) => tab !== "all" && MATCHERS[tab](keyword),
  );
}

export type DeepDiveKeyword = Keyword & {
  /** Which sources offered this phrase. */
  sources: string[];
};
