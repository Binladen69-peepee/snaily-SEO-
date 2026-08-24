/**
 * What happens if nobody does anything.
 *
 * The "do nothing" line is the most important number in the whole feature and
 * the one most often left out. Without it, every forecast looks like a win:
 * "12,000 clicks in six months" sounds like progress right up until you notice
 * the site was already going to earn 11,400. The incremental figure — the only
 * one worth acting on — is the difference between the plan and this.
 *
 * The modelling here is deliberately restrained. With two years of data a
 * seasonal decomposition is worth running; with eight weeks it is astrology,
 * and the honest output is a flat line with a wide band. So the method is
 * chosen from what the data can actually support, and the choice is reported.
 */

import type { Baseline, Figure, MonthPoint, Seasonality, TrendShape } from "@/lib/foresight/types";
import { figure, unavailableFigure } from "@/lib/foresight/types";
import { MIN_SEASONALITY_DAYS, MIN_TREND_DAYS } from "@/lib/foresight/readiness";

export type DailyPoint = { date: Date; clicks: number; impressions: number; position: number };

/** Months needed before a trend is fitted rather than a flat average taken. */
const MIN_MONTHS_FOR_TREND = 3;

/**
 * How much of the trend survives each month into the future.
 *
 * A straight-line extrapolation of three good months predicts a site earning
 * more clicks than there are people, which is the standard way naive
 * forecasting embarrasses itself. Damping the slope means the projection bends
 * towards flat, which is both more realistic and more conservative — an
 * estimate that is wrong should be wrong in the direction that costs less.
 */
const DAMPING = 0.85;

export function toMonthKey(date: Date): string {
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toMonthKey(d);
}

/** Rolls daily rows into calendar months, weighting position by impressions. */
export function toMonthly(daily: DailyPoint[]): MonthPoint[] {
  const months = new Map<string, { clicks: number; impressions: number; weighted: number }>();

  for (const d of daily) {
    const key = toMonthKey(d.date);
    const m = months.get(key) ?? { clicks: 0, impressions: 0, weighted: 0 };
    m.clicks += d.clicks;
    m.impressions += d.impressions;
    m.weighted += d.position * d.impressions;
    months.set(key, m);
  }

  return [...months.entries()]
    .map(([month, m]) => ({
      month,
      clicks: m.clicks,
      impressions: m.impressions,
      position: m.impressions > 0 ? m.weighted / m.impressions : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Theil-Sen slope: the median of all pairwise slopes.
 *
 * Chosen over least squares because SEO history is full of single catastrophic
 * or miraculous months — a migration, an outage, a viral post — and one of them
 * is enough to tilt a regression line into a forecast nobody believes. The
 * median pairwise slope ignores them without anyone having to decide by hand
 * which months were "real".
 */
export function theilSen(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };

  const slopes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      slopes.push((values[j]! - values[i]!) / (j - i));
    }
  }
  slopes.sort((a, b) => a - b);
  const slope = median(slopes);

  const intercepts = values.map((v, i) => v - slope * i);
  intercepts.sort((a, b) => a - b);

  return { slope, intercept: median(intercepts) };
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Share of variance the fitted line explains, clamped to 0–1. */
function goodnessOfFit(values: number[], slope: number, intercept: number): number {
  if (values.length < 3) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const ssTot = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  if (ssTot === 0) return 1;
  const ssRes = values.reduce((s, v, i) => s + (v - (intercept + slope * i)) ** 2, 0);
  return Math.max(0, Math.min(1, 1 - ssRes / ssTot));
}

/**
 * Monthly seasonal coefficients, by ratio to a centred moving average.
 *
 * Needs a full year to see a cycle at all, and says so rather than producing
 * twelve numbers from nine months of data — which would encode this year's
 * accidents as next year's expectations.
 */
export function detectSeasonality(history: MonthPoint[]): Seasonality | null {
  if (history.length < 12) return null;

  const clicks = history.map((h) => h.clicks);
  const n = clicks.length;

  // Centred 12-month moving average, so the trend is removed before the
  // seasonal shape is read off what is left.
  const ratios: { month: number; ratio: number }[] = [];
  for (let i = 6; i < n - 6; i += 1) {
    let sum = 0;
    for (let k = i - 6; k <= i + 6; k += 1) {
      sum += clicks[k]! * (k === i - 6 || k === i + 6 ? 0.5 : 1);
    }
    const average = sum / 12;
    if (average <= 0) continue;
    const monthIndex = new Date(`${history[i]!.month}T00:00:00Z`).getUTCMonth();
    ratios.push({ month: monthIndex, ratio: clicks[i]! / average });
  }

  if (ratios.length < 6) return null;

  const byMonth = new Map<number, number[]>();
  for (const r of ratios) {
    const list = byMonth.get(r.month) ?? [];
    list.push(r.ratio);
    byMonth.set(r.month, list);
  }

  const coefficients = Array.from({ length: 12 }, (_, m) => {
    const list = byMonth.get(m);
    if (list === undefined || list.length === 0) return 1;
    return median([...list].sort((a, b) => a - b));
  });

  // Normalised so a full year of coefficients multiplies out to no net change;
  // otherwise seasonality would quietly add or remove annual traffic.
  const mean = coefficients.reduce((s, v) => s + v, 0) / 12;
  const normalised = mean === 0 ? coefficients : coefficients.map((c) => c / mean);

  const peakMonth = normalised.indexOf(Math.max(...normalised));
  const troughMonth = normalised.indexOf(Math.min(...normalised));
  const strength = Math.min(1, (Math.max(...normalised) - Math.min(...normalised)) / 1.0);

  return {
    coefficients: normalised,
    peakMonth,
    troughMonth,
    years: Math.floor(n / 12),
    strength,
  };
}

/**
 * Months where the level shifted abruptly.
 *
 * Not an attempt to name algorithm updates — this app has no way to know that a
 * given Tuesday was a core update, and claiming otherwise would be exactly the
 * sort of confident nonsense this engine is meant to avoid. It reports that
 * something changed and by how much, which is what a person needs in order to
 * go and find out what it was.
 */
export function findChangepoints(history: MonthPoint[]): { month: string; detail: string }[] {
  if (history.length < 8) return [];

  const out: { month: string; detail: string }[] = [];
  const window = 3;

  for (let i = window; i <= history.length - window; i += 1) {
    const before = history.slice(i - window, i).map((h) => h.clicks);
    const after = history.slice(i, i + window).map((h) => h.clicks);

    const meanBefore = before.reduce((s, v) => s + v, 0) / before.length;
    const meanAfter = after.reduce((s, v) => s + v, 0) / after.length;
    if (meanBefore <= 0) continue;

    const change = (meanAfter - meanBefore) / meanBefore;
    if (Math.abs(change) < 0.35) continue;

    out.push({
      month: history[i]!.month,
      detail: `${change > 0 ? "Up" : "Down"} ${String(Math.round(Math.abs(change) * 100))}% against the previous three months.`,
    });
    i += window - 1;
  }

  return out;
}

export function describeShape(slope: number, level: number, fit: number): TrendShape {
  if (level <= 0) return "unknown";
  const monthlyChange = slope / level;
  if (fit < 0.2) return "flat";
  if (monthlyChange > 0.02) return "growing";
  if (monthlyChange < -0.02) return "declining";
  return "flat";
}

/**
 * The do-nothing projection.
 *
 * Returns an unavailable baseline rather than a zero one when there is no
 * history: a flat line at zero would be rendered as a forecast of no traffic,
 * which is a claim, and the truthful output is that nothing is known.
 */
export function buildBaseline(
  daily: DailyPoint[],
  horizonMonths: number,
  allowSeasonality: boolean,
): Baseline {
  const history = toMonthly(daily);
  const historyDays = daily.length;

  const empty: Baseline = {
    history,
    projection: [],
    shape: "unknown",
    slopePerMonth: 0,
    fit: 0,
    seasonality: null,
    changepoints: [],
    horizonClicks: unavailableFigure(
      "No measured history, so there is nothing to project forward. Connect Search Console to model what happens if nothing changes.",
    ),
  };

  if (history.length === 0 || historyDays < MIN_TREND_DAYS) return empty;

  /*
   * The most recent month is usually incomplete — Search Console reports up to
   * a two-day lag and the sync runs mid-month — so including it would read as a
   * collapse in traffic and tilt the trend downwards.
   */
  const complete = history.length > 1 ? history.slice(0, -1) : history;
  if (complete.length === 0) return empty;

  const clicks = complete.map((h) => h.clicks);
  const usesTrend = complete.length >= MIN_MONTHS_FOR_TREND;

  const { slope, intercept } = usesTrend
    ? theilSen(clicks)
    : { slope: 0, intercept: clicks.reduce((s, v) => s + v, 0) / clicks.length };

  const fit = usesTrend ? goodnessOfFit(clicks, slope, intercept) : 0;
  const lastIndex = clicks.length - 1;
  const level = intercept + slope * lastIndex;

  const seasonality =
    allowSeasonality && historyDays >= MIN_SEASONALITY_DAYS
      ? detectSeasonality(complete)
      : null;

  const lastMonth = complete[complete.length - 1]!.month;

  const projection: { month: string; clicks: Figure }[] = [];
  let damped = 0;

  for (let h = 1; h <= horizonMonths; h += 1) {
    // Damped trend: each further month inherits less of the slope, so the
    // projection flattens instead of running away.
    damped += DAMPING ** h;
    const month = addMonths(lastMonth, h);
    const seasonal =
      seasonality === null
        ? 1
        : (seasonality.coefficients[new Date(`${month}T00:00:00Z`).getUTCMonth()] ?? 1);

    const value = Math.max(0, (level + slope * damped) * seasonal);

    projection.push({
      month,
      clicks: figure(
        Math.round(value),
        "modeled",
        usesTrend
          ? `Damped ${slope >= 0 ? "upward" : "downward"} trend from ${String(complete.length)} complete months${seasonality === null ? "" : ", adjusted for the seasonal pattern in the history"}.`
          : `Average of ${String(complete.length)} complete months. Too little history to fit a trend, so the line is held flat.`,
        "Google Search Console",
      ),
    });
  }

  const total = projection.reduce((s, p) => s + (p.clicks.value ?? 0), 0);

  return {
    history,
    projection,
    shape: describeShape(slope, level, fit),
    slopePerMonth: Math.round(slope * 10) / 10,
    fit: Math.round(fit * 100) / 100,
    seasonality,
    changepoints: findChangepoints(complete),
    horizonClicks: figure(
      Math.round(total),
      "modeled",
      `Clicks over ${String(horizonMonths)} months if nothing changes, from a damped trend over ${String(complete.length)} complete months of Search Console data.`,
      "Google Search Console",
    ),
  };
}
