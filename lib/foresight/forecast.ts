/**
 * The forecast, assembled.
 *
 * Everything above this file is a model of one thing; this is where they meet,
 * in a fixed order, with the readiness gate deciding which of them are allowed
 * to speak. The order matters: readiness first, because it determines whether a
 * traffic number may be produced at all; then the CTR curve, because every
 * click figure downstream depends on it; then the baseline, because the only
 * number worth acting on is the difference from it.
 *
 * No model call anywhere in here. The engine is deterministic — the same
 * evidence and the same assumptions produce the same forecast, byte for byte —
 * which is what makes it possible to store one and compare it against reality
 * six months later. An LLM writes the summary paragraph elsewhere; it does not
 * touch a number.
 */

import { findCannibalization } from "@/lib/seo/cannibalization";
import { buildCtrModel, type CtrModel } from "@/lib/foresight/ctr";
import { loadEvidence, type Evidence } from "@/lib/foresight/evidence";
import { findOpportunities } from "@/lib/foresight/opportunities";
import { buildPlan, effectStartsMonth } from "@/lib/foresight/plan";
import { assessReadiness } from "@/lib/foresight/readiness";
import { assessReachability } from "@/lib/foresight/reachability";
import { buildSerpFeatureModel, type SerpFeatureModel } from "@/lib/foresight/serp-features";
import { rampFactor } from "@/lib/foresight/scenario";
import { simulate } from "@/lib/foresight/simulate";
import { estimateTimeToRank } from "@/lib/foresight/time-to-rank";
import { backtest } from "@/lib/foresight/backtest";
import { buildBaseline, toMonthKey } from "@/lib/foresight/trend";
import {
  ASSUMPTION_VERSION,
  MODEL_VERSION,
  figure,
  unavailableFigure,
  type Assumptions,
  type BusinessOutcome,
  type Forecast,
  type KeywordProjection,
} from "@/lib/foresight/types";
import { describeAssumptions } from "@/lib/foresight/scenario";

/** Keywords projected individually. Beyond this the table stops being read. */
const MAX_PROJECTIONS = 50;

/** A query that is somebody looking for this site, not a ranking to win. */
function isNavigationalQuery(query: string, brandTerms: string[]): boolean {
  const q = query.toLowerCase().trim();
  if (q.includes("://") || q.startsWith("www.")) return true;
  if (/\.(com|co|org|net|io|uk)(\/|$)/.test(q)) return true;
  return brandTerms.some((t) => q === t || q.startsWith(`${t} `));
}

function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toMonthKey(d);
}

/**
 * Builds one keyword's projection.
 *
 * The target position is what the user asked for; `expectedPosition` is what
 * the reachability model believes, and it is the one the click maths uses. That
 * substitution is the single most important line in the file — without it, a
 * user can forecast their way to position 1 on fifty keywords at once and the
 * tool will agree with them.
 */
function projectKeyword(input: {
  keyword: string;
  page: string | null;
  currentPosition: number | null;
  impressionsPerMonth: number | null;
  demandNote: string;
  demandSource: KeywordProjection["demandSource"];
  targetPosition: number;
  evidence: Evidence;
  ctr: CtrModel;
  serpModel: SerpFeatureModel;
  assumptions: Assumptions;
}): KeywordProjection {
  const { evidence, ctr, serpModel, assumptions } = input;

  const serp = evidence.serps.find((s) => s.query === input.keyword);
  const features = serp?.features ?? [];
  const serpMultiplier = serpModel.multiplierFor(features);

  const page = input.page === null ? null : evidence.pages.find((p) => p.url === input.page);
  const history = evidence.rankHistory.find((r) => r.keyword === input.keyword)?.positions ?? [];

  const words = input.keyword.split(/\s+/).filter((w) => w.length > 3);
  const topicalDepth = evidence.contentTitles.filter((t) =>
    words.some((w) => t.toLowerCase().includes(w)),
  ).length;

  const reachability = assessReachability({
    currentPosition: input.currentPosition,
    targetPosition: input.targetPosition,
    domainAuthority: evidence.domainAuthority,
    pageAuthority: null,
    competitors: (serp?.competitors ?? []).map((c) => ({
      position: c.position,
      domainAuthority: c.domainAuthority,
      pageAuthority: c.pageAuthority,
      domainLinkingDomains: c.domainLinkingDomains,
      wordCount: c.wordCount,
    })),
    wordCount: page?.wordCount ?? 0,
    internalLinks: page?.internalLinks ?? 0,
    technicalIssues: page?.blockingIssues ?? 0,
    indexable: page?.indexable ?? true,
    hasMatchingPage: page !== undefined || input.currentPosition !== null,
    topicalDepth,
    history,
  });

  const timeToRank = estimateTimeToRank({
    currentPosition: input.currentPosition,
    targetPosition: input.targetPosition,
    reachability,
    pageExists: page !== undefined || input.currentPosition !== null,
    domainAuthority: evidence.domainAuthority,
    timeMultiplier: assumptions.timeMultiplier,
  });

  // The scenario's achievement lever compounds with reachability rather than
  // replacing it: one describes how hard the SERP is, the other how well the
  // work is expected to go, and both have to hold for the gain to land.
  const achieved = reachability.achievement * assumptions.rankAchievement;
  const current = input.currentPosition;

  // Never forecast a position worse than today's: a keyword already inside its
  // target has no gap left to close. See the note in `reachability.ts`.
  const expected =
    current === null
      ? reachability.expectedPosition
      : current <= input.targetPosition
        ? current
        : Math.max(1, current - (current - input.targetPosition) * achieved);

  const currentCtrValue =
    current === null ? null : ctr.rate(current) * serpMultiplier;
  const forecastCtrValue = ctr.rate(expected) * serpMultiplier * assumptions.ctrMultiplier;

  const demand = input.impressionsPerMonth;

  const currentClicks =
    demand === null || currentCtrValue === null
      ? unavailableFigure(input.demandNote)
      : figure(
          Math.round(demand * currentCtrValue),
          "derived",
          "Measured impressions × measured click-through at the current position.",
          "Google Search Console",
        );

  const forecastClicks =
    demand === null
      ? unavailableFigure(input.demandNote)
      : figure(
          Math.round(demand * forecastCtrValue),
          "modeled",
          `Impressions × the modelled click-through at position ${expected.toFixed(1)}${features.length > 0 ? ", after the SERP-feature adjustment" : ""}.`,
        );

  const incremental =
    forecastClicks.value === null || currentClicks.value === null
      ? unavailableFigure(input.demandNote)
      : figure(
          Math.max(0, forecastClicks.value - currentClicks.value),
          "modeled",
          "The difference between the modelled position and today's. This is the only number worth acting on.",
        );

  const ctrProvenance = ctr.summary.source === "site" ? "derived" : "estimated";

  const priority = Math.round(
    Math.min(100, (incremental.value ?? 0) * 0.6 + reachability.achievement * 40),
  );

  return {
    keyword: input.keyword,
    page: input.page,
    currentPosition:
      current === null
        ? unavailableFigure("This keyword does not currently rank in the data available.")
        : figure(current, "real", "Impression-weighted average position.", "Google Search Console"),
    targetPosition: input.targetPosition,
    expectedPosition: figure(
      Math.round(expected * 10) / 10,
      "modeled",
      `Reachability judged this ${reachability.band.replace("-", " ")}: ${String(Math.round(reachability.achievement * 100))}% of the gap to position ${String(input.targetPosition)} is expected to close.`,
    ),
    demand:
      demand === null
        ? unavailableFigure(input.demandNote)
        : figure(Math.round(demand), input.demandSource === "gsc-impressions" ? "real" : "estimated", input.demandNote, input.demandSource === "gsc-impressions" ? "Google Search Console" : undefined),
    demandSource: input.demandSource,
    currentCtr:
      currentCtrValue === null
        ? unavailableFigure("No current position, so no current click-through.")
        : figure(Math.round(currentCtrValue * 10000) / 100, ctrProvenance, ctr.summary.note),
    forecastCtr: figure(
      Math.round(forecastCtrValue * 10000) / 100,
      "modeled",
      `${ctr.summary.label}, at position ${expected.toFixed(1)}, × ${serpMultiplier.toFixed(2)} for SERP features × ${assumptions.ctrMultiplier.toFixed(2)} for the scenario.`,
    ),
    currentClicks,
    forecastClicks,
    incrementalClicks: incremental,
    reachability,
    timeToRank,
    priority,
    confidence: Math.round(
      Math.min(0.9, reachability.evidence * 0.5 + ctr.summary.confidence * 0.3 + (history.length >= 3 ? 0.2 : 0.05)) * 100,
    ) / 100,
    serpFeatures: features,
  };
}

export type ForecastOptions = {
  projectId: string;
  siteUrl: string;
  assumptions: Assumptions;
  overrides?: Partial<Assumptions>;
  /** Specific keywords the user chose. Empty means "pick the best". */
  selectedKeywords?: string[];
  userId: string;
};

export async function buildForecast(options: ForecastOptions): Promise<Forecast> {
  const { projectId, siteUrl, assumptions, userId } = options;

  const evidence = await loadEvidence(projectId, siteUrl);

  const readiness = assessReadiness(evidence, assumptions.conversionRate !== null);

  const ctr = await buildCtrModel(projectId);
  const [serpModel, cannibalGroups] = await Promise.all([
    buildSerpFeatureModel(projectId, ctr, evidence.serps),
    findCannibalization(userId, projectId).catch(() => []),
  ]);

  const baseline = buildBaseline(
    evidence.daily,
    assumptions.horizonMonths,
    readiness.capabilities.seasonality,
  );

  const opportunities = findOpportunities({
    evidence,
    ctr,
    serpModel,
    targetPosition: assumptions.defaultTargetPosition,
    cannibalGroups,
  });

  const plan = buildPlan(opportunities, assumptions);

  /* ---- Keyword projections ------------------------------------------- */

  const chosen = new Set((options.selectedKeywords ?? []).map((k) => k.toLowerCase()));

  const candidates: {
    keyword: string;
    position: number | null;
    impressionsPerMonth: number | null;
    note: string;
    source: KeywordProjection["demandSource"];
  }[] = [];

  for (const q of evidence.queries) {
    if (chosen.size > 0 && !chosen.has(q.query)) continue;
    if (q.impressions < 50) continue;
    candidates.push({
      keyword: q.query,
      position: q.position,
      impressionsPerMonth: q.days > 0 ? (q.impressions / q.days) * 30 : q.impressions,
      note: "Monthly impressions measured by Search Console. This is first-party demand evidence, not a keyword-tool volume estimate.",
      source: "gsc-impressions",
    });
  }

  /*
   * Tracked keywords fill in where Search Console is silent — which today is
   * everywhere. Their stored volume is a deterministic estimate produced by
   * this app, not a measurement, so it is labelled `estimated` and its note
   * says so plainly rather than letting it pass as demand.
   */
  for (const r of evidence.rankHistory) {
    if (chosen.size > 0 && !chosen.has(r.keyword)) continue;
    if (candidates.some((c) => c.keyword === r.keyword)) continue;
    candidates.push({
      keyword: r.keyword,
      position: r.positions.length > 0 ? r.positions[r.positions.length - 1]! : null,
      impressionsPerMonth: r.volume > 0 ? r.volume : null,
      note:
        r.volume > 0
          ? "Estimated monthly searches. No keyword-volume provider is connected, so this is modelled from phrase shape and intent — treat it as an ordering, not a figure."
          : "No demand data. Search Console has no impressions for this keyword and no volume provider is connected, so no click forecast is produced.",
      source: r.volume > 0 ? "provider" : "none",
    });
  }

  /*
   * Cached SERPs are the third source, and today the only one with anything in
   * it. Where SerpApi recorded this site in the results, the position is a real
   * observation — so reachability, the gaps and time-to-rank are all genuinely
   * computable even with no Google connection at all. Demand is not, and is
   * reported unavailable rather than filled in from the volume estimator.
   */
  for (const serp of evidence.serps) {
    if (serp.ownPosition === null) continue;
    if (chosen.size > 0 && !chosen.has(serp.query)) continue;
    if (candidates.some((c) => c.keyword === serp.query)) continue;
    /*
     * Skip navigational and URL-shaped queries. "https://cinnamonsnail.com/"
     * was appearing in the ranking forecast as a keyword to optimise, which is
     * somebody typing the address bar into Google.
     */
    if (isNavigationalQuery(serp.query, evidence.brandTerms)) continue;
    candidates.push({
      keyword: serp.query,
      position: serp.ownPosition,
      impressionsPerMonth: null,
      note: "This position was observed in a cached search result page. No demand figure is available: Search Console has no impressions for it and no keyword-volume provider is connected, so no click forecast is produced.",
      source: "none",
    });
  }

  const keywords = candidates
    .sort((a, b) => (b.impressionsPerMonth ?? 0) - (a.impressionsPerMonth ?? 0))
    .slice(0, MAX_PROJECTIONS)
    .map((c) =>
      projectKeyword({
        keyword: c.keyword,
        page: null,
        currentPosition: c.position,
        impressionsPerMonth: c.impressionsPerMonth,
        demandNote: c.note,
        demandSource: c.source,
        targetPosition: assumptions.defaultTargetPosition,
        evidence,
        ctr,
        serpModel,
        assumptions,
      }),
    )
    .sort((a, b) => b.priority - a.priority);

  /* ---- Monthly traffic ------------------------------------------------ */

  const horizon = assumptions.horizonMonths;
  const baselineMonthly = Array.from(
    { length: horizon },
    (_, i) => baseline.projection[i]?.clicks.value ?? 0,
  );

  /*
   * Incremental clicks are attributed to the month the work's effect actually
   * starts, then ramped. An action scheduled in month 4 with a 60-day lag
   * contributes to month 6 onwards and nothing before it — which is why a
   * three-month horizon shows so much less than a twelve-month one even with
   * the same plan behind it.
   */
  const incrementalMonthly = new Array<number>(horizon).fill(0);
  const byKeyword = new Map(keywords.map((k) => [k.keyword, k]));

  for (const action of plan) {
    const start = effectStartsMonth(action);
    if (start === null || start >= horizon) continue;

    const perMonth =
      action.keyword !== null
        ? (byKeyword.get(action.keyword)?.incrementalClicks.value ?? action.impactClicks.value ?? 0)
        : (action.impactClicks.value ?? 0);
    if (perMonth <= 0) continue;

    for (let m = start; m < horizon; m += 1) {
      incrementalMonthly[m]! += perMonth * rampFactor(m - start, horizon, assumptions.rampShare);
    }
  }

  const months = baselineMonthly.map((base, i) => ({
    month:
      baseline.projection[i]?.month ??
      addMonths(toMonthKey(new Date()), i + 1),
    baseline: Math.round(base),
    expected: Math.round(base + incrementalMonthly[i]!),
  }));

  const baselineTotal = baselineMonthly.reduce((s, v) => s + v, 0);
  const incrementalTotal = incrementalMonthly.reduce((s, v) => s + v, 0);
  const forecastTotal = baselineTotal + incrementalTotal;

  const canForecastTraffic = readiness.capabilities.trafficForecast;

  const noTrafficNote =
    "Traffic forecasting needs measured clicks to project from. Connect Search Console and this fills in — nothing here is estimated in the meantime.";

  const recentMonthly =
    baseline.history.length > 0
      ? baseline.history[baseline.history.length - (baseline.history.length > 1 ? 2 : 1)]!.clicks
      : 0;

  const totals = {
    currentMonthlyClicks: canForecastTraffic
      ? figure(recentMonthly, "real", "Clicks in the last complete month.", "Google Search Console")
      : unavailableFigure(noTrafficNote),
    baselineHorizonClicks: canForecastTraffic
      ? baseline.horizonClicks
      : unavailableFigure(noTrafficNote),
    forecastHorizonClicks: canForecastTraffic
      ? figure(
          Math.round(forecastTotal),
          "modeled",
          `Baseline plus the modelled effect of the ${String(plan.filter((p) => p.scheduledMonth !== null).length)} actions that fit inside ${String(horizon)} months.`,
        )
      : unavailableFigure(noTrafficNote),
    incrementalClicks: canForecastTraffic
      ? figure(
          Math.round(incrementalTotal),
          "modeled",
          "What the plan adds over doing nothing. The only figure here worth making a decision on.",
        )
      : unavailableFigure(noTrafficNote),
    changePercent:
      canForecastTraffic && baselineTotal > 0
        ? figure(
            Math.round((incrementalTotal / baselineTotal) * 1000) / 10,
            "modeled",
            "Incremental clicks as a share of the do-nothing baseline.",
          )
        : unavailableFigure(noTrafficNote),
  };

  /* ---- Uncertainty ---------------------------------------------------- */

  const uncertaintyLevel = Math.max(
    0.15,
    1 - (readiness.score / 100) * 0.7 - ctr.summary.confidence * 0.3,
  );

  const uncertainty = canForecastTraffic
    ? simulate({
        baseline: baselineMonthly,
        incremental: incrementalMonthly,
        uncertaintyLevel,
        seed: `${projectId}|${assumptions.scenario}|${String(horizon)}|${MODEL_VERSION}`,
      })
    : { band: { p10: [], p50: [], p90: [] }, drivers: [], simulated: false, runs: 0 };

  /* ---- Business outcome ----------------------------------------------- */

  const business: BusinessOutcome | null =
    assumptions.conversionRate === null || totals.incrementalClicks.value === null
      ? null
      : (() => {
          const conversions = totals.incrementalClicks.value * assumptions.conversionRate;
          const revenue =
            assumptions.revenuePerConversion === null
              ? null
              : conversions * assumptions.revenuePerConversion;

          return {
            conversions: figure(
              Math.round(conversions),
              "modeled",
              "Modelled incremental clicks × the conversion rate you supplied. Nothing in this system measures your conversion rate.",
            ),
            revenue:
              revenue === null
                ? unavailableFigure("No value per conversion supplied, so revenue is not modelled.")
                : figure(
                    Math.round(revenue),
                    "modeled",
                    "Modelled conversions × the value per conversion you supplied. A model output, not a projection of guaranteed revenue.",
                  ),
            adsEquivalent: unavailableFigure(
              "Google Ads-equivalent value needs trustworthy CPC data, which no connected source supplies. It is left blank rather than estimated from a keyword-tool figure.",
            ),
            assumptions: describeAssumptions(assumptions, options.overrides ?? {}).filter(
              (a) => a.label === "Conversion rate" || a.label === "Value per conversion",
            ),
          };
        })();

  /* ---- Confidence, only if earned ------------------------------------- */

  const evaluation = backtest(evidence.daily, 3);

  return {
    modelVersion: MODEL_VERSION,
    assumptionVersion: ASSUMPTION_VERSION,
    generatedAt: new Date().toISOString(),
    dataCutoff: evidence.dataCutoff,
    dataSources: [
      {
        label: "Clicks, impressions, positions",
        source: evidence.daily.length > 0 ? "Google Search Console" : "Not connected",
        provenance: evidence.daily.length > 0 ? "real" : "unavailable",
      },
      {
        label: "SERP results and features",
        source: `SERP cache (${String(evidence.serps.length)} result pages, DataForSEO/SerpApi, no new calls)`,
        provenance: evidence.serps.length > 0 ? "real" : "unavailable",
      },
      {
        label: "Page inventory and technical health",
        source: evidence.pages.length > 0 ? "Site audit" : "No completed audit",
        provenance: evidence.pages.length > 0 ? "real" : "unavailable",
      },
      {
        label: "Ranking history",
        source:
          evidence.rankHistory.length > 0
            ? `Rank Tracker (${String(evidence.rankHistory.length)} keywords)`
            : "No tracked keywords",
        provenance: evidence.rankHistory.length > 0 ? "real" : "unavailable",
      },
      {
        label: "Click-through rate",
        source: ctr.summary.label,
        provenance: ctr.summary.source === "site" ? "derived" : "estimated",
      },
      {
        label: "Site authority",
        source: evidence.domainAuthority === null ? "Never looked up" : "DataForSEO Rank or Snaily Domain Authority",
        provenance: evidence.domainAuthority === null ? "unavailable" : "derived",
      },
    ],
    readiness,
    assumptions,
    assumptionNotes: describeAssumptions(assumptions, options.overrides ?? {}),
    baseline,
    totals,
    months,
    uncertainty,
    keywords,
    opportunities,
    plan,
    business,
    ctrModel: ctr.summary,
    confidence: evaluation.report,
  };
}
