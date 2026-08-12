import { prisma } from "@/lib/db";

/**
 * Rank tracking from Search Console.
 *
 * Google already records your position for every query, every day, for free
 * and with no quota. Re-checking the same keywords through a SERP API would
 * cost one credit per keyword per day and return a less accurate number — the
 * SERP a scraper sees is not personalised, geolocated or averaged the way a
 * real user's is. So this reads what Google measured rather than guessing.
 */

export type TrackedKeyword = {
  keyword: string;
  /** Average position over the recent window. */
  position: number;
  /** Average over the window before it, or null when there is no history. */
  previous: number | null;
  /** Positive = improved (moved up the page). */
  change: number | null;
  clicks: number;
  impressions: number;
  ctr: number;
  /** Daily positions, oldest first, for the sparkline. */
  series: { date: string; position: number }[];
  best: number;
  worst: number;
};

export type TrackingReport = {
  keywords: TrackedKeyword[];
  /** Days of history actually present. */
  daysCovered: number;
  improved: number;
  declined: number;
  top3: number;
  top10: number;
  firstDate: string | null;
  lastDate: string | null;
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function getTrackingReport(
  projectId: string,
  days = 28,
  filter?: string[],
): Promise<TrackingReport> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.gscQueryMetric.findMany({
    where: {
      projectId,
      date: { gte: since },
      ...(filter && filter.length > 0 ? { query: { in: filter } } : {}),
    },
    orderBy: { date: "asc" },
    select: {
      query: true,
      date: true,
      position: true,
      clicks: true,
      impressions: true,
    },
  });

  if (rows.length === 0) {
    return {
      keywords: [],
      daysCovered: 0,
      improved: 0,
      declined: 0,
      top3: 0,
      top10: 0,
      firstDate: null,
      lastDate: null,
    };
  }

  const dates = [...new Set(rows.map((r) => r.date.toISOString().slice(0, 10)))].sort();
  // The split point for "recent" vs "previous"; with a short history both
  // halves are simply smaller.
  const half = Math.max(1, Math.floor(dates.length / 2));
  const recentFrom = dates[dates.length - half]!;

  const byQuery = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byQuery.get(row.query);
    if (list) list.push(row);
    else byQuery.set(row.query, [row]);
  }

  const keywords: TrackedKeyword[] = [];

  for (const [keyword, entries] of byQuery) {
    const series = entries.map((e) => ({
      date: e.date.toISOString().slice(0, 10),
      position: Math.round(e.position * 10) / 10,
    }));

    const recent = series.filter((s) => s.date >= recentFrom);
    const older = series.filter((s) => s.date < recentFrom);

    const position = Math.round(average(recent.map((s) => s.position)) * 10) / 10;
    const previous =
      older.length === 0
        ? null
        : Math.round(average(older.map((s) => s.position)) * 10) / 10;

    const clicks = entries.reduce((s, e) => s + e.clicks, 0);
    const impressions = entries.reduce((s, e) => s + e.impressions, 0);
    const positions = series.map((s) => s.position);

    keywords.push({
      keyword,
      position,
      previous,
      // Position 3 → 1 is an improvement, so the sign is flipped deliberately.
      change: previous === null ? null : Math.round((previous - position) * 10) / 10,
      clicks,
      impressions,
      ctr: impressions === 0 ? 0 : clicks / impressions,
      series,
      best: Math.min(...positions),
      worst: Math.max(...positions),
    });
  }

  keywords.sort((a, b) => b.impressions - a.impressions);

  return {
    keywords,
    daysCovered: dates.length,
    improved: keywords.filter((k) => (k.change ?? 0) > 0.5).length,
    declined: keywords.filter((k) => (k.change ?? 0) < -0.5).length,
    top3: keywords.filter((k) => k.position <= 3).length,
    top10: keywords.filter((k) => k.position <= 10).length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}
