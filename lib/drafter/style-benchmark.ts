/**
 * Scoring a draft against the client's own writing.
 *
 * Five numbers the author can see: how closely the prose behaves like the
 * corpus, how much generic writing is left, whether anything was invented,
 * whether each section kept its documented shape, and whether the recipe on
 * the page is the recipe they pasted.
 *
 * Invented claims, ungrounded ingredients, leaked style-example facts,
 * pipeline markers and the named generic metaphors are hard gates. A post
 * that reads a bit flat is a disappointment; a post that says testers in
 * Portland loved the coconut milk is a lie published under their name.
 */

import { checkStyle, hardFailIssues, splitSections, type StyleIssue } from "@/lib/drafter/style-check";
import { averageMetrics, measureProse, type StyleMetrics } from "@/lib/drafter/style-metrics";

export type Benchmark = {
  /** 0-100. How close the prose behaves to the reference corpus. */
  styleMatch: number;
  /** Generic-writing hits per 1,000 words. Lower is better. */
  genericAi: number;
  /** 0-100. 100 means nothing ungrounded was found. */
  grounding: number;
  /** 0-100. Share of expected sections present and correctly shaped. */
  sectionCompliance: number;
  /** 0-100. 100 means no hallucinated ingredients or leaked example-recipe facts. */
  recipeAccuracy: number;
  /** Hard gate. Anything above zero fails the article. */
  inventedClaims: number;
  /** Everything the checker found, for the report and the repair pass. */
  issues: StyleIssue[];
  /** The measurements behind `styleMatch`, for the log. */
  metrics: StyleMetrics;
  reference: StyleMetrics;
  passed: boolean;
};

/**
 * How a metric should be compared to the reference.
 *
 * Not every metric is a target to hit. Sentence length is - writing at 28
 * words is wrong and so is writing at 6. But a post with twice the corpus's
 * average of asides and house slang is not twice as wrong as one with none;
 * it is a livelier post than average, which is what the client is asking for.
 * Scoring every metric as "hit the mean" marked the client's own most
 * voice-forward article down for being voice-forward.
 */
type Direction =
  /** Both directions are a miss. */
  | "match"
  /** Under the reference is fine; over it is the failure. */
  | "lower-better"
  /** Under the reference is the failure; over it barely matters. */
  | "higher-ok";

/**
 * The metrics that carry the voice, and how much each one matters.
 *
 * Chosen from the measured gap between the corpus and a real generated draft:
 * sentence length, the share of short sentences and the generic-adjective rate
 * were the three that were wildly out, so they carry the most weight.
 */
const WEIGHTS: { key: keyof StyleMetrics; weight: number; direction: Direction }[] = [
  { key: "meanSentenceWords", weight: 3, direction: "match" },
  { key: "shortSentenceShare", weight: 3, direction: "higher-ok" },
  { key: "longSentenceShare", weight: 2, direction: "lower-better" },
  { key: "genericFoodAdjectives", weight: 3, direction: "lower-better" },
  { key: "meanParagraphSentences", weight: 2, direction: "match" },
  { key: "singleSentenceParagraphShare", weight: 1, direction: "higher-ok" },
  { key: "parentheticals", weight: 2, direction: "higher-ok" },
  { key: "secondPerson", weight: 1, direction: "higher-ok" },
  { key: "firstPerson", weight: 2, direction: "higher-ok" },
  { key: "slang", weight: 2, direction: "higher-ok" },
  { key: "openingVariety", weight: 1, direction: "higher-ok" },
];

/**
 * How close one measurement is to its reference, 0-1.
 *
 * A ratio rather than a difference, because the metrics sit on wildly
 * different scales - 16 words a sentence against 0.27 of a share.
 */
function closeness(actual: number, reference: number, direction: Direction): number {
  if (reference === 0) return actual === 0 ? 1 : direction === "lower-better" ? 0 : 1;

  const ratio = actual / reference;

  if (direction === "lower-better") {
    return ratio <= 1 ? 1 : Math.max(0, 1 - (ratio - 1) / 3);
  }

  if (direction === "higher-ok") {
    // Overshooting is mildly off; falling short is the whole complaint.
    return ratio >= 1 ? Math.max(0.75, 1 - (ratio - 1) / 8) : Math.max(0, ratio);
  }

  return ratio <= 1 ? Math.max(0, ratio) : Math.max(0, 1 - (ratio - 1));
}

/** Sections the client's format expects on every recipe post. */
const EXPECTED = ["why", "ingredients", "how-to-make", "serving", "tips", "faqs"];

export type BenchmarkInput = {
  html: string;
  recipeIngredients: string[];
  /** Title, keyword and method as well as ingredients, for leak-term checks. */
  recipeText?: string;
  /** The client's own published posts, as HTML. */
  corpus: string[];
};

export function benchmark(input: BenchmarkInput): Benchmark {
  const metrics = measureProse(input.html);
  const reference = averageMetrics(input.corpus.map(measureProse));
  const issues = checkStyle({
    html: input.html,
    recipeIngredients: input.recipeIngredients,
    recipeText: input.recipeText,
  });

  let score = 0;
  let total = 0;
  for (const { key, weight, direction } of WEIGHTS) {
    score += closeness(metrics[key], reference[key], direction) * weight;
    total += weight;
  }
  const styleMatch = total === 0 ? 0 : Math.round((score / total) * 100);

  const per1k = (n: number) =>
    metrics.words === 0 ? 0 : Math.round((n / metrics.words) * 1_000 * 100) / 100;

  const generic = issues.filter((i) =>
    ["generic opening", "cliche", "filler adjectives", "generic metaphor"].includes(i.rule),
  ).length;

  const ungrounded = issues.filter((i) => i.rule === "ungrounded ingredient").length;
  const leaked = issues.filter((i) => i.rule === "style leak").length;
  const invented = issues.filter((i) => i.rule === "invented claim").length;
  const recipeHits = ungrounded + leaked;
  const recipeAccuracy = recipeHits === 0 ? 100 : Math.max(0, 100 - recipeHits * 25);

  const present = new Set(
    splitSections(input.html)
      .map((s) => s.key)
      .filter((k): k is NonNullable<typeof k> => k !== null),
  );
  const found = EXPECTED.filter((key) => present.has(key as never)).length;
  const sectionCompliance = Math.round((found / EXPECTED.length) * 100);

  return {
    styleMatch,
    genericAi: per1k(generic),
    grounding: ungrounded === 0 ? 100 : Math.max(0, 100 - ungrounded * 25),
    sectionCompliance,
    recipeAccuracy,
    inventedClaims: invented,
    issues,
    metrics,
    reference,
    passed: hardFailIssues(issues).length === 0,
  };
}
