/**
 * What else is on the page, and what it costs the organic result.
 *
 * Every SERP this app has ever fetched is already stored in `SerpCache` with
 * the full provider response, so the features are free to read: no new API
 * call, no quota spent. On this deployment that is 272 cached Google result
 * pages, and 85% of the sampled ones carry an AI Overview — which is not a
 * detail. A recipe query whose answer Google summarises above the fold does not
 * hand position 3 the click share that position 3 earned in 2019, and a
 * forecast that ignores it will overstate every number downstream.
 *
 * The detection is real. The *penalty* is the hard part, and this file is
 * careful about it: where Search Console has enough measured data, the
 * adjustment is derived from this site's own clicks by comparing queries that
 * have a feature against queries that do not, at comparable positions. Where it
 * does not, documented default assumptions are used and labelled as
 * assumptions. There is no third option where a number is invented and
 * presented as a finding.
 */

import { prisma } from "@/lib/db";
import type { CtrModel } from "@/lib/foresight/ctr";
import type { ForesightProvenance } from "@/lib/foresight/types";

/** The features worth modelling, keyed by the provider's own response field. */
export const SERP_FEATURES = [
  "ai_overview",
  "answer_box",
  "related_questions",
  "local_results",
  "shopping_results",
  "inline_videos",
  "inline_images",
  "knowledge_graph",
  "ads",
  "top_stories",
  "discussions_and_forums",
  "recipes_results",
] as const;

export type SerpFeature = (typeof SERP_FEATURES)[number];

export const SERP_FEATURE_LABEL: Record<SerpFeature, string> = {
  ai_overview: "AI Overview",
  answer_box: "Featured Snippet",
  related_questions: "People Also Ask",
  local_results: "Local Pack",
  shopping_results: "Shopping",
  inline_videos: "Video",
  inline_images: "Images",
  knowledge_graph: "Knowledge Panel",
  ads: "Ads",
  top_stories: "Top Stories",
  discussions_and_forums: "Forums",
  recipes_results: "Recipes",
};

/**
 * Default multipliers on organic CTR when a feature is present.
 *
 * These are assumptions, not measurements, and they are deliberately mild.
 * Published estimates of, say, the AI Overview's effect on organic clicks range
 * from negligible to catastrophic depending on who measured and which vertical
 * they measured in, so picking a precise number here would be inventing
 * evidence. What is defensible is the ordering — a feature that answers the
 * query outright costs more clicks than one that decorates the page — and a
 * magnitude conservative enough that being wrong is survivable.
 *
 * Every one of these is replaced by a site-measured value as soon as Search
 * Console supplies enough data to measure it.
 */
export const DEFAULT_ADJUSTMENTS: Record<SerpFeature, number> = {
  ai_overview: 0.75,
  answer_box: 0.85,
  related_questions: 0.95,
  local_results: 0.8,
  shopping_results: 0.85,
  inline_videos: 0.95,
  inline_images: 0.97,
  knowledge_graph: 0.9,
  ads: 0.9,
  top_stories: 0.92,
  discussions_and_forums: 0.97,
  recipes_results: 0.95,
};

export const ADJUSTMENT_RATIONALE: Record<SerpFeature, string> = {
  ai_overview:
    "Google answers the query above the organic results, so a share of searchers never scroll.",
  answer_box: "The answer is on the page already; the click is optional.",
  related_questions: "Pushes organic results down but keeps them clickable.",
  local_results: "A map pack takes the top of the page for local intent.",
  shopping_results: "Product tiles absorb commercial clicks.",
  inline_videos: "Video carousels displace organic results without answering the query.",
  inline_images: "Image strips shift results down a little.",
  knowledge_graph: "An entity panel satisfies simple factual intent.",
  ads: "Paid results take clicks from the top of the page.",
  top_stories: "News carousels take the position above organic.",
  discussions_and_forums: "Forum results add competition for the same intent.",
  recipes_results: "A recipe carousel captures part of the click share.",
};

/** How many measured queries a feature needs before its effect is believed. */
const MIN_QUERIES_PER_FEATURE = 25;

/** Impressions needed on both sides of the comparison. */
const MIN_IMPRESSIONS_PER_SIDE = 2_000;

export type FeatureAdjustment = {
  feature: SerpFeature;
  label: string;
  multiplier: number;
  provenance: ForesightProvenance;
  rationale: string;
  /** Queries behind a derived multiplier. Zero for an assumption. */
  sample: number;
};

export type SerpFeatureModel = {
  adjustments: Record<SerpFeature, FeatureAdjustment>;
  /** Features seen across this project's cached SERPs, with how often. */
  prevalence: { feature: SerpFeature; label: string; queries: number; share: number }[];
  /** Cached SERPs examined. */
  serpsRead: number;
  /** Combined multiplier for a set of features present on one query. */
  multiplierFor: (features: SerpFeature[]) => number;
};

/** Reads the features present in one cached provider payload. */
export function featuresIn(payload: unknown): SerpFeature[] {
  if (payload === null || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;

  return SERP_FEATURES.filter((f) => {
    const v = obj[f];
    if (v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return Boolean(v);
  });
}

/**
 * Combines the multipliers for the features on one SERP.
 *
 * Multiplied rather than summed, and floored: five features present does not
 * mean organic traffic goes to nothing, and a model that says so would be
 * obviously wrong to anyone who has looked at a busy SERP and still clicked a
 * result.
 */
function combine(
  features: SerpFeature[],
  adjustments: Record<SerpFeature, FeatureAdjustment>,
): number {
  const product = features.reduce((m, f) => m * (adjustments[f]?.multiplier ?? 1), 1);
  return Math.max(0.35, product);
}

type QueryRow = { query: string; clicks: number; impressions: number; position: number };

/**
 * Measures a feature's effect from this site's own Search Console data.
 *
 * The comparison is against what the site's CTR curve expected at the same
 * position, not against a raw average — otherwise the result would mostly
 * measure the fact that feature-carrying queries rank differently, which is a
 * different thing entirely.
 */
function deriveMultiplier(
  withFeature: QueryRow[],
  withoutFeature: QueryRow[],
  ctr: CtrModel,
): number | null {
  const ratio = (rows: QueryRow[]): number | null => {
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    if (impressions < MIN_IMPRESSIONS_PER_SIDE) return null;

    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const expected = rows.reduce((s, r) => s + ctr.rate(r.position) * r.impressions, 0);
    if (expected <= 0) return null;

    return clicks / expected;
  };

  const a = ratio(withFeature);
  const b = ratio(withoutFeature);
  if (a === null || b === null || b === 0) return null;

  // Bounded: a measured multiplier outside this range is far more likely to be
  // a sampling artefact than a real doubling or annihilation of click share.
  return Math.min(1.4, Math.max(0.3, a / b));
}

/**
 * Builds the SERP feature model for a project.
 *
 * Reads only cached SERPs and already-synced Search Console rows, so it costs
 * nothing to run and can be recomputed on every page load.
 */
export async function buildSerpFeatureModel(
  projectId: string,
  ctr: CtrModel,
  /**
   * The cached SERPs, already read by the evidence loader.
   *
   * Passed in rather than queried again. This used to run its own copy of the
   * same 12 MB query the evidence loader had just finished, which doubled the
   * cost of every forecast to re-derive facts that were sitting in memory.
   */
  cached: { query: string; features: SerpFeature[] }[],
): Promise<SerpFeatureModel> {
  const queryRows = await prisma.gscQueryMetric.findMany({
    where: { projectId, impressions: { gt: 0 } },
    select: { query: true, clicks: true, impressions: true, position: true },
  });

  const byQuery = new Map<string, SerpFeature[]>();
  for (const row of cached) {
    const plain = row.query.toLowerCase().trim();
    if (plain === "") continue;
    const existing = byQuery.get(plain);
    byQuery.set(
      plain,
      existing === undefined ? row.features : [...new Set([...existing, ...row.features])],
    );
  }

  const counts = new Map<SerpFeature, number>();
  for (const features of byQuery.values()) {
    for (const f of features) counts.set(f, (counts.get(f) ?? 0) + 1);
  }

  const prevalence = SERP_FEATURES.map((feature) => ({
    feature,
    label: SERP_FEATURE_LABEL[feature],
    queries: counts.get(feature) ?? 0,
    share: byQuery.size === 0 ? 0 : (counts.get(feature) ?? 0) / byQuery.size,
  }))
    .filter((p) => p.queries > 0)
    .sort((a, b) => b.queries - a.queries);

  const adjustments = {} as Record<SerpFeature, FeatureAdjustment>;

  for (const feature of SERP_FEATURES) {
    const withFeature: QueryRow[] = [];
    const withoutFeature: QueryRow[] = [];

    for (const row of queryRows) {
      const features = byQuery.get(row.query.toLowerCase().trim());
      if (features === undefined) continue;
      (features.includes(feature) ? withFeature : withoutFeature).push(row);
    }

    const enoughQueries =
      new Set(withFeature.map((r) => r.query)).size >= MIN_QUERIES_PER_FEATURE &&
      new Set(withoutFeature.map((r) => r.query)).size >= MIN_QUERIES_PER_FEATURE;

    const measured = enoughQueries
      ? deriveMultiplier(withFeature, withoutFeature, ctr)
      : null;

    adjustments[feature] =
      measured === null
        ? {
            feature,
            label: SERP_FEATURE_LABEL[feature],
            multiplier: DEFAULT_ADJUSTMENTS[feature],
            provenance: "estimated",
            rationale: `${ADJUSTMENT_RATIONALE[feature]} This multiplier is a documented assumption — there is not enough measured data on this site to derive it.`,
            sample: 0,
          }
        : {
            feature,
            label: SERP_FEATURE_LABEL[feature],
            multiplier: Math.round(measured * 100) / 100,
            provenance: "derived",
            rationale: `${ADJUSTMENT_RATIONALE[feature]} Measured on this site: queries showing this feature earn ${String(Math.round(measured * 100))}% of the clicks the CTR curve expects at the same position, compared with queries that do not.`,
            sample: new Set(withFeature.map((r) => r.query)).size,
          };
  }

  return {
    adjustments,
    prevalence,
    serpsRead: byQuery.size,
    multiplierFor: (features) => combine(features, adjustments),
  };
}

/** Features on one specific query, read from cache. Empty when never fetched. */
export async function featuresForQuery(
  query: string,
  country = "us",
): Promise<SerpFeature[]> {
  const row = await prisma.serpCache.findFirst({
    where: { engine: "google", query: query.toLowerCase().trim(), country },
    select: { payload: true },
  });
  return row === null ? [] : featuresIn(row.payload);
}
