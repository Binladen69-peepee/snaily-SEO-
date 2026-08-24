/**
 * The vocabulary of the Foresight engine.
 *
 * Two rules are encoded in these types rather than left to discipline.
 *
 * First, every number carries where it came from. The app already has a
 * four-state provenance system for measurements; Foresight adds `modeled`,
 * because "the forecast says 3,400 clicks" is a genuinely different kind of
 * claim from "Search Console measured 3,400 clicks", and collapsing the two is
 * the single most damaging thing a forecasting tool can do.
 *
 * Second, a forecast is a record, not a number. Assumptions, model version and
 * data cutoff travel with every output, so a forecast made today can still be
 * explained — and argued with — in six months when the actuals disagree.
 */

import type { Provenance } from "@/lib/metrics/provenance";

/**
 * Bumped whenever the maths changes in a way that would move a number.
 *
 * Stored on every saved forecast. Without it, comparing a forecast against
 * reality later measures the difference between two models as well as the
 * difference between prediction and outcome, and nobody can tell which.
 */
export const MODEL_VERSION = "foresight-1.0.0";

/** Bumped when a default assumption changes, independently of the maths. */
export const ASSUMPTION_VERSION = "assumptions-1.0.0";

/* -------------------------------------------------------------------------
 * Provenance
 * ---------------------------------------------------------------------- */

/**
 * Provenance, extended with the one state a forecasting engine needs.
 *
 * `modeled` sits below `derived`: a derived number is arithmetic over things
 * that happened, while a modeled number is a claim about things that have not
 * happened yet. It is weaker than every measurement and stronger than nothing,
 * and it must never be rendered in the same style as a measurement.
 */
export const FORESIGHT_PROVENANCE = [
  "real",
  "derived",
  "modeled",
  "estimated",
  "unavailable",
] as const;

export type ForesightProvenance = (typeof FORESIGHT_PROVENANCE)[number];

export const FORESIGHT_PROVENANCE_LABEL: Record<ForesightProvenance, string> = {
  real: "Real",
  derived: "Derived",
  modeled: "Modeled",
  estimated: "Estimated",
  unavailable: "Unavailable",
};

export const FORESIGHT_PROVENANCE_NOTE: Record<ForesightProvenance, string> = {
  real: "Measured directly by a first-party API.",
  derived: "Calculated from measured inputs using a documented formula.",
  modeled: "A projection of something that has not happened. Not a measurement, and not a promise.",
  estimated: "Inferred from indirect signals. Treat as a rough ordering, not a figure.",
  unavailable: "No trustworthy source supplies this. It is not guessed.",
};

export const FORESIGHT_PROVENANCE_TONE: Record<ForesightProvenance, string> = {
  real: "bg-success/12 text-success",
  derived: "bg-primary/12 text-primary",
  modeled: "bg-chart-3/15 text-chart-3",
  estimated: "bg-warning/15 text-warning",
  unavailable: "bg-muted text-muted-foreground",
};

const ORDER: Record<ForesightProvenance, number> = {
  real: 0,
  derived: 1,
  modeled: 2,
  estimated: 3,
  unavailable: 4,
};

/** The provenance of a value computed from several others: the weakest one. */
export function weakestOf(...sources: ForesightProvenance[]): ForesightProvenance {
  if (sources.length === 0) return "unavailable";
  return sources.reduce((worst, s) => (ORDER[s] > ORDER[worst] ? s : worst));
}

/** Lifts the app's existing four-state provenance into Foresight's five. */
export function fromMetric(p: Provenance): ForesightProvenance {
  return p;
}

/** A number that knows what kind of claim it is. */
export type Figure = {
  value: number | null;
  provenance: ForesightProvenance;
  /** What this is and how it was produced. Shown on hover, never omitted. */
  note: string;
  /** Where it came from, e.g. "Google Search Console". */
  source?: string;
};

export function figure(
  value: number | null,
  provenance: ForesightProvenance,
  note: string,
  source?: string,
): Figure {
  return { value, provenance, note, source };
}

export function unavailableFigure(note: string): Figure {
  return { value: null, provenance: "unavailable", note };
}

/* -------------------------------------------------------------------------
 * Horizons and scenarios
 * ---------------------------------------------------------------------- */

export const HORIZONS = [3, 6, 12] as const;
export type Horizon = (typeof HORIZONS)[number];

export function parseHorizon(value: unknown): Horizon {
  const n = Number(value);
  return HORIZONS.includes(n as Horizon) ? (n as Horizon) : 6;
}

export const SCENARIOS = ["conservative", "expected", "aggressive"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const SCENARIO_LABEL: Record<Scenario, string> = {
  conservative: "Conservative",
  expected: "Expected",
  aggressive: "Aggressive",
};

export function parseScenario(value: unknown): Scenario {
  return SCENARIOS.includes(value as Scenario) ? (value as Scenario) : "expected";
}

export const FORECAST_TARGETS = ["traffic", "leads", "revenue"] as const;
export type ForecastTarget = (typeof FORECAST_TARGETS)[number];

/* -------------------------------------------------------------------------
 * Assumptions
 * ---------------------------------------------------------------------- */

/**
 * Every lever the forecast depends on, in one object.
 *
 * Saved verbatim alongside the result. A forecast whose assumptions were not
 * written down cannot be re-examined later — the only honest answer to "why did
 * it say that?" becomes "we no longer know", which is how forecasting tools lose
 * the trust they need to be useful.
 */
export type Assumptions = {
  horizonMonths: Horizon;
  scenario: Scenario;

  /** How much of the ranking gain to the target actually lands, 0–1. */
  rankAchievement: number;
  /** Multiplier on the modelled CTR, for execution quality. */
  ctrMultiplier: number;
  /** Multiplier on time-to-rank; above 1 means slower. */
  timeMultiplier: number;
  /** Share of the horizon spent ramping before full effect, 0–1. */
  rampShare: number;

  /** Optional business inputs. Null means the user has not supplied one. */
  conversionRate: number | null;
  revenuePerConversion: number | null;

  /** Execution capacity, which caps how many actions can land. */
  contentVelocity: {
    articlesPerMonth: number;
    optimisationsPerMonth: number;
    internalLinksPerMonth: number;
  };

  /** Target position the user is aiming selected keywords at. */
  defaultTargetPosition: number;
};

export type AssumptionNote = {
  label: string;
  value: string;
  /** Why this assumption is what it is. */
  why: string;
  /** True when the user set it rather than accepting the default. */
  userSet: boolean;
};

/* -------------------------------------------------------------------------
 * Readiness
 * ---------------------------------------------------------------------- */

export type ReadinessCheckStatus = "pass" | "warn" | "fail";

export type ReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessCheckStatus;
  detail: string;
  /** Weight in the readiness score. */
  weight: number;
  /** What the user should do about it, when there is something. */
  fix?: { label: string; href: string };
};

export type Readiness = {
  /** 0–100. */
  score: number;
  checks: ReadinessCheck[];
  /** What the engine is allowed to produce at this level of data. */
  capabilities: {
    baseline: boolean;
    trafficForecast: boolean;
    seasonality: boolean;
    siteCtrCurve: boolean;
    reachability: boolean;
    revenue: boolean;
    backtest: boolean;
  };
  /** Plain sentence explaining any limit, shown above the forecast. */
  limitation: string | null;
};

/* -------------------------------------------------------------------------
 * Time series
 * ---------------------------------------------------------------------- */

export type MonthPoint = {
  /** First day of the month, ISO date. */
  month: string;
  clicks: number;
  impressions: number;
  position: number;
};

export type TrendShape = "growing" | "flat" | "declining" | "unknown";

export type Baseline = {
  /** Observed history, oldest first. Empty when nothing is connected. */
  history: MonthPoint[];
  /** Projected months if nothing changes, oldest first. */
  projection: { month: string; clicks: Figure }[];
  shape: TrendShape;
  /** Clicks per month change implied by the fitted trend. */
  slopePerMonth: number;
  /** 0–1, how well the trend explains the history. */
  fit: number;
  seasonality: Seasonality | null;
  changepoints: { month: string; detail: string }[];
  /** Total clicks over the horizon if nothing is done. */
  horizonClicks: Figure;
};

export type Seasonality = {
  /** 12 multipliers, index 0 = January. 1.0 means an average month. */
  coefficients: number[];
  peakMonth: number;
  troughMonth: number;
  /** How many complete years of history backed this. */
  years: number;
  strength: number;
};

/* -------------------------------------------------------------------------
 * Reachability
 * ---------------------------------------------------------------------- */

export const REACHABILITY_BANDS = [
  "likely",
  "realistic",
  "stretch",
  "too-ambitious",
] as const;

export type ReachabilityBand = (typeof REACHABILITY_BANDS)[number];

export const REACHABILITY_LABEL: Record<ReachabilityBand, string> = {
  likely: "Likely",
  realistic: "Realistic",
  stretch: "Stretch",
  "too-ambitious": "Too ambitious",
};

export type Gap = {
  label: string;
  /** 0–100. 0 means no gap; 100 means the gap is as wide as it gets. */
  size: number;
  detail: string;
  provenance: ForesightProvenance;
};

export type Reachability = {
  band: ReachabilityBand;
  /** 0–1. The share of the intended gain the model expects to land. */
  achievement: number;
  gaps: { authority: Gap; content: Gap; technical: Gap; serp: Gap };
  /** Position the model actually expects, which may not be the target. */
  expectedPosition: number;
  reasons: string[];
  /** 0–1. How much evidence sits behind this judgement. */
  evidence: number;
};

export type TimeToRank = {
  fastestDays: number;
  expectedDays: number;
  slowerDays: number;
  drivers: string[];
};

/* -------------------------------------------------------------------------
 * Keyword projections
 * ---------------------------------------------------------------------- */

export type DemandSource = "gsc-impressions" | "provider" | "imported" | "none";

export type KeywordProjection = {
  keyword: string;
  page: string | null;

  currentPosition: Figure;
  targetPosition: number;
  expectedPosition: Figure;

  /** Monthly search demand, whatever kind of number it turns out to be. */
  demand: Figure;
  demandSource: DemandSource;

  currentCtr: Figure;
  forecastCtr: Figure;

  currentClicks: Figure;
  forecastClicks: Figure;
  incrementalClicks: Figure;

  reachability: Reachability;
  timeToRank: TimeToRank | null;

  /** 0–100, for ordering work. */
  priority: number;
  /** 0–1. */
  confidence: number;
  serpFeatures: string[];
};

/* -------------------------------------------------------------------------
 * Opportunities and the plan
 * ---------------------------------------------------------------------- */

export const OPPORTUNITY_KINDS = [
  // "striking distance" covers both shapes the brief names — a page at 6
  // aiming for the top 3 and one at 11 aiming for page one are the same
  // detection with a different distance, and splitting them would put two
  // labels on one finding.
  "striking-distance",
  "low-ctr",
  "content-gap",
  "cannibalization",
  "internal-links",
  "technical",
  "serp-feature",
] as const;

export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export type Effort = "low" | "medium" | "high";

export type Opportunity = {
  id: string;
  kind: OpportunityKind;
  title: string;
  detail: string;
  /** Modelled incremental monthly clicks, or null when demand is unknown. */
  impactClicks: Figure;
  /** 0–100 relative impact, always available even when clicks are not. */
  impactScore: number;
  effort: Effort;
  confidence: number;
  timeToImpactDays: number | null;
  action: string;
  keyword: string | null;
  page: string | null;
  evidence: { label: string; detail: string; provenance: ForesightProvenance }[];
};

export const QUADRANTS = ["quick-win", "strategic", "maintain", "deprioritize"] as const;
export type Quadrant = (typeof QUADRANTS)[number];

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  "quick-win": "Quick wins",
  strategic: "Strategic",
  maintain: "Maintain",
  deprioritize: "Deprioritise",
};

export type PlanAction = {
  id: string;
  order: number;
  /** Carried from the opportunity so like work can be grouped when it repeats. */
  kind: OpportunityKind;
  title: string;
  why: string;
  effort: Effort;
  quadrant: Quadrant;
  confidence: number;
  impactClicks: Figure;
  timeToImpactDays: number | null;
  keyword: string | null;
  page: string | null;
  /** Which month of the horizon this lands in, given the velocity cap. */
  scheduledMonth: number | null;
};

/* -------------------------------------------------------------------------
 * The forecast itself
 * ---------------------------------------------------------------------- */

export type ForecastBand = {
  /** Monthly clicks, oldest first. */
  p10: number[];
  p50: number[];
  p90: number[];
};

export type Uncertainty = {
  band: ForecastBand;
  /** Where the spread comes from, so it can be reduced deliberately. */
  drivers: { label: string; share: number; detail: string }[];
  /** True when the range came from simulation rather than fixed multipliers. */
  simulated: boolean;
  runs: number;
};

export type BusinessOutcome = {
  conversions: Figure;
  revenue: Figure;
  adsEquivalent: Figure;
  assumptions: AssumptionNote[];
};

export type ForecastTotals = {
  currentMonthlyClicks: Figure;
  baselineHorizonClicks: Figure;
  forecastHorizonClicks: Figure;
  incrementalClicks: Figure;
  changePercent: Figure;
};

export type Forecast = {
  modelVersion: string;
  assumptionVersion: string;
  generatedAt: string;
  /** Last day of data behind this forecast. */
  dataCutoff: string | null;
  dataSources: { label: string; source: string; provenance: ForesightProvenance }[];

  readiness: Readiness;
  assumptions: Assumptions;
  assumptionNotes: AssumptionNote[];

  baseline: Baseline;
  totals: ForecastTotals;
  /** Monthly expected clicks with the plan executed, oldest first. */
  months: { month: string; baseline: number; expected: number }[];
  uncertainty: Uncertainty;

  keywords: KeywordProjection[];
  opportunities: Opportunity[];
  plan: PlanAction[];

  business: BusinessOutcome | null;
  ctrModel: CtrModelSummary;
  /** Null until the model has been evaluated against real outcomes. */
  confidence: ConfidenceReport | null;
};

export type CtrModelSummary = {
  source: "site" | "fallback";
  label: string;
  /** Impressions behind the curve. Zero for the fallback. */
  sampleSize: number;
  /** 0–1. */
  confidence: number;
  note: string;
  /** CTR by position 1–10, as a percentage. */
  curve: number[];
};

export type ConfidenceReport = {
  /** 0–1, only ever set once a backtest has run. */
  score: number;
  mae: number;
  mape: number | null;
  directionAccuracy: number;
  intervalCoverage: number;
  windows: number;
  note: string;
};
