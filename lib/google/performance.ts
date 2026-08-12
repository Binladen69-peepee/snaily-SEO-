import { prisma } from "@/lib/db";

/**
 * Per-URL Google performance, aggregated over a recent window and keyed by
 * pathname so it can be joined against crawled audit pages.
 *
 * Content Intelligence uses this to rank pages by what they are actually worth
 * rather than by URL depth: a page with real clicks and impressions matters
 * more than a deep page nobody visits.
 */

export type PagePerformance = {
  clicks: number;
  impressions: number;
  ctr: number;
  /** Average Google position, weighted by impressions. */
  position: number;
  sessions: number;
  users: number;
  engagementRate: number;
};

/** Normalises any URL or path to a comparable pathname. */
export function toPath(input: string): string {
  try {
    const u = new URL(input);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    const p = input.split("?")[0]!.replace(/\/+$/, "");
    return p === "" ? "/" : p.startsWith("/") ? p : `/${p}`;
  }
}

export type PerformanceMap = Map<string, PagePerformance>;

export async function getPagePerformance(
  projectId: string,
  days = 28,
): Promise<PerformanceMap> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const [gsc, ga4] = await Promise.all([
    prisma.gscPageMetric.findMany({
      where: { projectId, date: { gte: since } },
      select: { page: true, clicks: true, impressions: true, position: true },
    }),
    prisma.ga4PageMetric.findMany({
      where: { projectId, date: { gte: since } },
      select: {
        pagePath: true,
        sessions: true,
        users: true,
        engagementRate: true,
      },
    }),
  ]);

  const map: PerformanceMap = new Map();

  const ensure = (path: string): PagePerformance => {
    let row = map.get(path);
    if (!row) {
      row = {
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
        sessions: 0,
        users: 0,
        engagementRate: 0,
      };
      map.set(path, row);
    }
    return row;
  };

  // Position must be impression-weighted, not a plain mean of daily averages.
  const weighted = new Map<string, number>();

  for (const r of gsc) {
    const row = ensure(toPath(r.page));
    row.clicks += r.clicks;
    row.impressions += r.impressions;
    weighted.set(
      toPath(r.page),
      (weighted.get(toPath(r.page)) ?? 0) + r.position * r.impressions,
    );
  }

  const engagementSamples = new Map<string, number>();
  for (const r of ga4) {
    const path = toPath(r.pagePath);
    const row = ensure(path);
    row.sessions += r.sessions;
    row.users += r.users;
    row.engagementRate += r.engagementRate;
    engagementSamples.set(path, (engagementSamples.get(path) ?? 0) + 1);
  }

  for (const [path, row] of map) {
    row.ctr = row.impressions > 0 ? row.clicks / row.impressions : 0;
    row.position =
      row.impressions > 0
        ? Math.round(((weighted.get(path) ?? 0) / row.impressions) * 10) / 10
        : 0;
    const n = engagementSamples.get(path) ?? 0;
    row.engagementRate = n > 0 ? row.engagementRate / n : 0;
  }

  return map;
}

/** True when a project has any Google data at all. */
export async function hasPerformanceData(projectId: string): Promise<boolean> {
  const n = await prisma.gscPageMetric.count({ where: { projectId } });
  if (n > 0) return true;
  return (await prisma.ga4PageMetric.count({ where: { projectId } })) > 0;
}
