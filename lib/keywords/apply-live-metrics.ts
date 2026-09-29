/**
 * Merge a DataForSEO row onto a modelled keyword without talking to the
 * network. Kept separate from `hydrate.ts` so tests do not pull Prisma.
 */

import type { Keyword } from "@/lib/keywords/types";

export type LiveMetricSlice = {
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  trend?: number[] | null;
  results?: number | null;
};

export function applyLiveMetrics(
  est: Keyword,
  row: LiveMetricSlice | undefined,
): Keyword {
  if (!row) return { ...est, metricsSource: "estimated" };

  const hasLive =
    row.searchVolume != null ||
    row.cpc != null ||
    row.competition != null ||
    row.difficulty != null;

  const trend =
    row.trend && row.trend.length === 12
      ? row.trend
      : est.trend.map((v, i) => {
          const livePt = row.trend?.[i];
          return typeof livePt === "number" ? livePt : v;
        });

  return {
    ...est,
    volume: row.searchVolume ?? est.volume,
    cpc: row.cpc ?? est.cpc,
    competition: row.competition ?? est.competition,
    difficulty: row.difficulty ?? est.difficulty,
    trend,
    results: row.results ?? est.results,
    metricsSource: hasLive ? "live" : "estimated",
  };
}
