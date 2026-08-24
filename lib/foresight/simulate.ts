/**
 * The range, and where the range comes from.
 *
 * A single forecast number is a lie of omission. The honest output is a band,
 * and — more useful than the band itself — an account of what is making it
 * wide, because that tells you which piece of missing evidence is worth going
 * and getting.
 *
 * The simulation is a plain Monte Carlo over the inputs that are genuinely
 * uncertain: how far the rankings move, what click-through the new positions
 * earn, and how the underlying baseline drifts. It is deterministic given a
 * seed, so the same forecast produces the same band twice — a forecast that
 * quietly changes on refresh is not one anybody can plan against.
 *
 * P10/P50/P90 here are percentiles of the model's own outputs. They are not
 * calibrated probabilities, and nothing in the UI calls them that: saying "10%
 * chance of doing worse than this" would require the model to have been checked
 * against reality often enough to know, which is what `backtest.ts` is for and
 * what this project does not yet have the history to run.
 */

import type { Uncertainty } from "@/lib/foresight/types";

const DEFAULT_RUNS = 800;

/** Deterministic PRNG so a forecast is reproducible from its inputs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Box-Muller, clamped so a tail draw cannot invert the sign of a multiplier. */
function normal(rng: () => number, mean: number, sd: number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * sd;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export type SimulationInput = {
  /** Baseline clicks per month, oldest first. */
  baseline: number[];
  /** Incremental clicks per month the plan is expected to add, oldest first. */
  incremental: number[];
  /**
   * How much is not known, 0–1, from the readiness and evidence scores.
   * Higher widens every distribution.
   */
  uncertaintyLevel: number;
  /** Stable string so the same forecast simulates identically twice. */
  seed: string;
  runs?: number;
};

export function simulate(input: SimulationInput): Uncertainty {
  const months = Math.max(input.baseline.length, input.incremental.length);
  const runs = input.runs ?? DEFAULT_RUNS;

  if (months === 0) {
    return {
      band: { p10: [], p50: [], p90: [] },
      drivers: [],
      simulated: false,
      runs: 0,
    };
  }

  const rng = mulberry32(seedFrom(input.seed));
  const u = Math.max(0.1, Math.min(0.9, input.uncertaintyLevel));

  /*
   * Three sources of spread, sized by how much evidence sits behind each.
   * Ranking movement is the widest because it is the least controllable; the
   * baseline is the narrowest because it is extrapolated from things that
   * actually happened.
   */
  const rankSd = 0.35 + u * 0.45;
  const ctrSd = 0.15 + u * 0.25;
  const baselineSd = 0.08 + u * 0.22;

  const perMonth: number[][] = Array.from({ length: months }, () => []);

  for (let run = 0; run < runs; run += 1) {
    // Drawn once per run, not per month: if rankings underperform this quarter
    // they underperform all quarter, and drawing independently each month would
    // average the uncertainty away and produce a falsely tight band.
    const rankDraw = Math.max(0, normal(rng, 1, rankSd));
    const ctrDraw = Math.max(0.2, normal(rng, 1, ctrSd));
    const baselineDraw = Math.max(0, normal(rng, 1, baselineSd));

    for (let m = 0; m < months; m += 1) {
      const base = (input.baseline[m] ?? 0) * baselineDraw;
      const extra = (input.incremental[m] ?? 0) * rankDraw * ctrDraw;
      perMonth[m]!.push(Math.max(0, base + extra));
    }
  }

  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];

  for (const values of perMonth) {
    values.sort((a, b) => a - b);
    p10.push(Math.round(percentile(values, 0.1)));
    p50.push(Math.round(percentile(values, 0.5)));
    p90.push(Math.round(percentile(values, 0.9)));
  }

  const total = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  const spread = total(p90) - total(p10);

  // Attribution by variance share, which is what actually drives the width.
  const variances = [
    { label: "Ranking movement", v: rankSd ** 2, detail: "How far positions actually move, and whether they hold." },
    { label: "Click-through", v: ctrSd ** 2, detail: "What share of impressions at the new position become clicks." },
    { label: "Baseline drift", v: baselineSd ** 2, detail: "How the site performs without any of the planned work." },
  ];
  const varianceTotal = variances.reduce((s, x) => s + x.v, 0);

  return {
    band: { p10, p50, p90 },
    drivers: variances.map((x) => ({
      label: x.label,
      share: Math.round((x.v / varianceTotal) * 100) / 100,
      detail: x.detail,
    })),
    simulated: spread > 0,
    runs,
  };
}
