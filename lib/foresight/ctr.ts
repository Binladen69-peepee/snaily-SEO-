/**
 * How often a result at a given position actually gets clicked — for this site.
 *
 * The app already ships a published industry CTR curve, and every traffic
 * estimate outside Foresight uses it. That curve is fine for ordering keywords
 * and wrong for forecasting a specific site's traffic: a recipe blog whose
 * results carry images and ratings earns a different click share at position 4
 * than a B2B software page does, and the gap is large enough to swamp the
 * ranking improvement being forecast.
 *
 * So when Search Console has supplied enough impressions, the curve is measured
 * from this site's own data. When it has not, the industry curve is used and
 * said to be the industry curve. The one thing never done is blending them
 * quietly, because a curve that is 60% measured and 40% assumed is reported as
 * measured by everyone who looks at it.
 */

import { prisma } from "@/lib/db";
import { ctrForPosition } from "@/lib/keywords/ctr";
import type { CtrModelSummary } from "@/lib/foresight/types";
import { MIN_CTR_IMPRESSIONS } from "@/lib/foresight/readiness";

/** Positions modelled individually. Past this, click share is noise. */
const MAX_POSITION = 20;

/** A bucket with fewer impressions than this is not evidence of anything. */
const MIN_BUCKET_IMPRESSIONS = 150;

/** Buckets in the top ten that must be populated for a site curve to stand. */
const MIN_POPULATED_TOP_TEN = 4;

export type CtrModel = {
  summary: CtrModelSummary;
  /** CTR as a fraction (0–1) for any position, including fractional ones. */
  rate: (position: number) => number;
  /** Measured impressions per position, for the methodology drawer. */
  samples: { position: number; impressions: number; clicks: number }[];
};

/**
 * Forces a curve to fall as position worsens.
 *
 * Real buckets are noisy: a site with 300 impressions at position 2 and 40,000
 * at position 3 can genuinely measure a higher CTR at 3. That is sampling
 * noise, not a discovery that being lower is better, and a forecast built on it
 * would reward pushing a keyword *down*. Pool-adjacent-violators is the
 * standard fix — it is still the site's own data, rearranged as little as the
 * monotonic constraint allows.
 */
function enforceDecreasing(
  points: { position: number; ctr: number; weight: number }[],
): { position: number; ctr: number; weight: number }[] {
  const out = points.map((p) => ({ ...p }));

  for (let i = 1; i < out.length; i += 1) {
    if (out[i]!.ctr <= out[i - 1]!.ctr) continue;

    // Merge backwards until the sequence is non-increasing again.
    let j = i;
    while (j > 0 && out[j]!.ctr > out[j - 1]!.ctr) {
      const a = out[j - 1]!;
      const b = out[j]!;
      const weight = a.weight + b.weight;
      const merged = weight === 0 ? (a.ctr + b.ctr) / 2 : (a.ctr * a.weight + b.ctr * b.weight) / weight;
      a.ctr = merged;
      b.ctr = merged;
      j -= 1;
    }
  }

  return out;
}

/** Linear interpolation across a sparse, position-indexed curve. */
function interpolate(
  points: { position: number; ctr: number }[],
  position: number,
): number {
  if (points.length === 0) return 0;
  if (position <= points[0]!.position) return points[0]!.ctr;

  const last = points[points.length - 1]!;
  if (position >= last.position) return last.ctr;

  for (let i = 1; i < points.length; i += 1) {
    const hi = points[i]!;
    if (hi.position < position) continue;
    const lo = points[i - 1]!;
    const span = hi.position - lo.position;
    if (span === 0) return hi.ctr;
    const t = (position - lo.position) / span;
    return lo.ctr + (hi.ctr - lo.ctr) * t;
  }

  return last.ctr;
}

/** The published industry curve, as a fraction, clearly labelled as such. */
export function fallbackCtrModel(reason: string): CtrModel {
  return {
    summary: {
      source: "fallback",
      label: "Industry average CTR curve",
      sampleSize: 0,
      confidence: 0.35,
      note: `${reason} A published industry-average curve is used instead. It is a reasonable ordering of positions, not a measurement of this site — real click-through varies enormously by intent, SERP features and brand.`,
      curve: Array.from({ length: 10 }, (_, i) => ctrForPosition(i + 1)),
    },
    rate: (position) => ctrForPosition(position) / 100,
    samples: [],
  };
}

/**
 * Builds the CTR curve for a project.
 *
 * Reads Search Console rows that have already been synced — no new API calls.
 * Falls back, loudly, whenever the evidence is too thin to beat the generic
 * curve, which on this deployment is currently every project.
 */
export async function buildCtrModel(projectId: string): Promise<CtrModel> {
  const rows = await prisma.gscQueryMetric.findMany({
    where: { projectId, impressions: { gt: 0 } },
    select: { clicks: true, impressions: true, position: true },
  });

  if (rows.length === 0) {
    return fallbackCtrModel("Search Console has no impression data for this project.");
  }

  const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);

  const buckets = new Map<number, { clicks: number; impressions: number }>();
  for (const row of rows) {
    // Position is an impression-weighted average, so it is fractional. The
    // bucket is the rank a searcher would actually have seen.
    const p = Math.round(row.position);
    if (p < 1 || p > MAX_POSITION) continue;
    const bucket = buckets.get(p) ?? { clicks: 0, impressions: 0 };
    bucket.clicks += row.clicks;
    bucket.impressions += row.impressions;
    buckets.set(p, bucket);
  }

  const samples = [...buckets.entries()]
    .map(([position, b]) => ({ position, impressions: b.impressions, clicks: b.clicks }))
    .sort((a, b) => a.position - b.position);

  const usable = samples.filter((s) => s.impressions >= MIN_BUCKET_IMPRESSIONS);
  const topTenPopulated = usable.filter((s) => s.position <= 10).length;

  if (totalImpressions < MIN_CTR_IMPRESSIONS || topTenPopulated < MIN_POPULATED_TOP_TEN) {
    return fallbackCtrModel(
      `Search Console has ${totalImpressions.toLocaleString()} impressions across ${String(topTenPopulated)} well-populated top-ten positions, which is too thin to measure a curve.`,
    );
  }

  const smoothed = enforceDecreasing(
    usable.map((s) => ({
      position: s.position,
      ctr: s.clicks / s.impressions,
      weight: s.impressions,
    })),
  );

  const curvePoints = smoothed.map((p) => ({ position: p.position, ctr: p.ctr }));

  /*
   * Confidence grows with evidence and stops well short of certainty. Even a
   * perfectly measured historical curve is an assumption about the future: it
   * describes the SERPs this site was in, not the ones it will be in after the
   * rankings move.
   */
  const volumeConfidence = Math.min(1, totalImpressions / (MIN_CTR_IMPRESSIONS * 10));
  const coverageConfidence = Math.min(1, topTenPopulated / 10);
  const confidence = Math.min(0.9, 0.4 + volumeConfidence * 0.3 + coverageConfidence * 0.3);

  const rate = (position: number): number => {
    if (!Number.isFinite(position) || position < 1) return 0;
    if (position > MAX_POSITION) {
      // Beyond the measured range the site's own data says nothing, so the
      // generic tail is used — and the note says so rather than pretending
      // the measurement extends further than it does.
      return ctrForPosition(position) / 100;
    }
    return interpolate(curvePoints, position);
  };

  const measuredMax = curvePoints[curvePoints.length - 1]!.position;

  return {
    summary: {
      source: "site",
      label: "Measured from this site's Search Console data",
      sampleSize: totalImpressions,
      confidence,
      note: `Built from ${totalImpressions.toLocaleString()} impressions across positions ${String(curvePoints[0]!.position)}–${String(measuredMax)}. Buckets with fewer than ${String(MIN_BUCKET_IMPRESSIONS)} impressions are excluded, and the curve is constrained to fall as position worsens so sampling noise cannot suggest that ranking lower earns more clicks. Positions beyond ${String(measuredMax)} use the industry tail.`,
      curve: Array.from({ length: 10 }, (_, i) => Math.round(rate(i + 1) * 1000) / 10),
    },
    rate,
    samples,
  };
}
