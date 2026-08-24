/**
 * Checking the model against what actually happened.
 *
 * Until this has run, Foresight has no business displaying a confidence score.
 * A number like "82% confident" that has never been compared against an outcome
 * is decoration — it makes the forecast feel trustworthy without any of the
 * work that would make it trustworthy, which is worse than showing nothing.
 *
 * So `confidence` on a forecast stays null until there is enough history to
 * hold out a window, refit on what came before it, and score the prediction
 * against the truth. On this deployment no project has that history yet, and
 * the UI says the model is unvalidated here rather than inventing a figure.
 *
 * The evaluation is rolling-origin: fit on everything before a cut date,
 * predict forward, score, then move the cut and repeat. That is the standard
 * way to evaluate a time-series model without letting it see its own future.
 */

import type { ConfidenceReport } from "@/lib/foresight/types";
import { buildBaseline, type DailyPoint, toMonthly } from "@/lib/foresight/trend";
import { MIN_BACKTEST_DAYS } from "@/lib/foresight/readiness";

export type BacktestWindow = {
  cutoff: string;
  horizonMonths: number;
  predicted: number[];
  actual: number[];
  /** The P10/P90 band at the time, for coverage scoring. */
  low: number[];
  high: number[];
};

export type BacktestResult = {
  ran: boolean;
  reason: string;
  windows: BacktestWindow[];
  report: ConfidenceReport | null;
};

/** Spread the simulation would have produced, as a fraction of the point. */
const ASSUMED_BAND = 0.35;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Runs rolling-origin evaluation over a project's daily history.
 *
 * `horizonMonths` is kept short on purpose. Evaluating a twelve-month forecast
 * needs twelve months of held-out truth on top of enough history to fit, which
 * almost no project has; a three-month horizon can be scored several times over
 * the same data and is what the numbers below actually describe.
 */
export function backtest(
  daily: DailyPoint[],
  horizonMonths = 3,
): BacktestResult {
  const sorted = [...daily].sort((a, b) => a.date.getTime() - b.date.getTime());

  if (sorted.length < MIN_BACKTEST_DAYS) {
    return {
      ran: false,
      reason: `Backtesting needs at least ${String(MIN_BACKTEST_DAYS)} days of history to hold a window out and still have enough left to fit on. This project has ${String(sorted.length)}.`,
      windows: [],
      report: null,
    };
  }

  const months = toMonthly(sorted);
  if (months.length < horizonMonths + 4) {
    return {
      ran: false,
      reason: `Backtesting a ${String(horizonMonths)}-month forecast needs at least ${String(horizonMonths + 4)} complete months. This project has ${String(months.length)}.`,
      windows: [],
      report: null,
    };
  }

  const windows: BacktestWindow[] = [];

  // Each pass hides the last `horizonMonths`, fits on the rest, and scores.
  for (let hold = horizonMonths; hold <= months.length - 4; hold += 1) {
    const cutIndex = months.length - hold;
    const cutMonth = months[cutIndex]!.month;
    const cutDate = new Date(`${cutMonth}T00:00:00Z`);

    const trainingDaily = sorted.filter((d) => d.date < cutDate);
    if (trainingDaily.length < 56) continue;

    const actualMonths = months.slice(cutIndex, cutIndex + horizonMonths);
    if (actualMonths.length < horizonMonths) continue;

    // Seasonality is switched off in the backtest for the same reason it is
    // switched off in a short-history forecast: fitting a yearly cycle on a
    // truncated series measures the truncation, not the year.
    const fitted = buildBaseline(trainingDaily, horizonMonths, false);
    if (fitted.projection.length === 0) continue;

    const predicted = fitted.projection.map((p) => p.clicks.value ?? 0);
    const actual = actualMonths.map((m) => m.clicks);

    windows.push({
      cutoff: cutMonth,
      horizonMonths,
      predicted,
      actual,
      low: predicted.map((v) => v * (1 - ASSUMED_BAND)),
      high: predicted.map((v) => v * (1 + ASSUMED_BAND)),
    });
  }

  if (windows.length === 0) {
    return {
      ran: false,
      reason: "Not enough complete windows to evaluate. More history is needed.",
      windows: [],
      report: null,
    };
  }

  const errors: number[] = [];
  const percentErrors: number[] = [];
  let directionHits = 0;
  let directionTotal = 0;
  let covered = 0;
  let coverageTotal = 0;

  for (const w of windows) {
    for (let i = 0; i < w.predicted.length; i += 1) {
      const p = w.predicted[i]!;
      const a = w.actual[i]!;
      errors.push(Math.abs(p - a));

      // MAPE is undefined against a zero actual and explodes near zero, so
      // months with negligible traffic are excluded from it rather than
      // allowed to dominate the average.
      if (a >= 10) percentErrors.push(Math.abs(p - a) / a);

      coverageTotal += 1;
      if (a >= w.low[i]! && a <= w.high[i]!) covered += 1;
    }

    // Direction: did the forecast get the sign of the change right?
    if (w.predicted.length >= 2 && w.actual.length >= 2) {
      const predictedUp = w.predicted[w.predicted.length - 1]! >= w.predicted[0]!;
      const actualUp = w.actual[w.actual.length - 1]! >= w.actual[0]!;
      directionTotal += 1;
      if (predictedUp === actualUp) directionHits += 1;
    }
  }

  const mae = Math.round(mean(errors));
  const mape = percentErrors.length === 0 ? null : mean(percentErrors);
  const directionAccuracy = directionTotal === 0 ? 0 : directionHits / directionTotal;
  const intervalCoverage = coverageTotal === 0 ? 0 : covered / coverageTotal;

  /*
   * A single score, weighted towards the two things a planner actually needs:
   * being roughly right about the level, and being right about the direction.
   * Interval coverage is included because a band that never contains the truth
   * is a band nobody should plan against.
   */
  const accuracyScore = mape === null ? 0.5 : Math.max(0, 1 - Math.min(1, mape));
  const score =
    accuracyScore * 0.45 + directionAccuracy * 0.35 + intervalCoverage * 0.2;

  return {
    ran: true,
    reason: `Evaluated over ${String(windows.length)} rolling ${String(horizonMonths)}-month windows.`,
    windows,
    report: {
      score: Math.round(score * 100) / 100,
      mae,
      mape: mape === null ? null : Math.round(mape * 1000) / 1000,
      directionAccuracy: Math.round(directionAccuracy * 100) / 100,
      intervalCoverage: Math.round(intervalCoverage * 100) / 100,
      windows: windows.length,
      note: `Measured by refitting the baseline model on data available before each cutoff and scoring it against what actually happened. MAE is in clicks per month; MAPE excludes months under 10 clicks, where percentage error is meaningless.`,
    },
  };
}
