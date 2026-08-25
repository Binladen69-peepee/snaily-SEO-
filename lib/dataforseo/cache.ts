/**
 * Cached DataForSEO backlink/rank lookups.
 *
 * Cache key: provider + endpoint + normalized target.
 * Auth failures are not written with a long TTL.
 */

import {
  fetchBacklinkSummary,
  fetchBulkRanks,
  normalizeTarget,
  type DataForSeoBacklinkSummary,
  type DataForSeoRankRow,
} from "@/lib/dataforseo/backlinks";
import { dataForSeoConfigured } from "@/lib/dataforseo/config";
import { DataForSeoError } from "@/lib/dataforseo/errors";
import { prisma } from "@/lib/db";

/** Successful rank/summary rows live for a week — backlink indexes move slowly. */
export const DFS_SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Empty / unknown targets retry sooner. */
export const DFS_EMPTY_TTL_MS = 6 * 60 * 60 * 1000;
/** Auth / balance failures — short so a top-up or env fix is picked up. */
export const DFS_AUTH_FAIL_TTL_MS = 5 * 60 * 1000;

export type DfsUsageEvent = {
  endpoint: string;
  requestCount: number;
  responseRows: number;
  estimatedCost: number;
  cacheHit: boolean;
  at: string;
};

/** In-process usage ring for diagnostics (not persisted). */
const usageLog: DfsUsageEvent[] = [];
const MAX_USAGE = 200;

function recordUsage(event: Omit<DfsUsageEvent, "at">): void {
  usageLog.push({ ...event, at: new Date().toISOString() });
  if (usageLog.length > MAX_USAGE) usageLog.shift();
}

export function recentDataForSeoUsage(): DfsUsageEvent[] {
  return [...usageLog];
}

export type CachedDomainAuthority = {
  domain: string;
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringPages: number | null;
  spamScore: number | null;
  fetchedAt: Date;
  fromCache: boolean;
  cost: number;
};

function isFresh(fetchedAt: Date | null | undefined, ttlMs: number): boolean {
  if (!fetchedAt) return false;
  return Date.now() - fetchedAt.getTime() < ttlMs;
}

/**
 * Bulk DataForSEO ranks for domains, reusing DomainMetric rows when fresh.
 */
export async function getCachedDataForSeoRanks(
  domains: string[],
  opts: { fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<Map<string, CachedDomainAuthority>> {
  const out = new Map<string, CachedDomainAuthority>();
  if (!dataForSeoConfigured()) return out;

  const cleaned = [
    ...new Set(domains.map(normalizeTarget).filter((d) => d !== "")),
  ];
  if (cleaned.length === 0) return out;

  let rows: Array<{
    domain: string;
    dataforseoRank: number | null;
    referringDomains: number | null;
    dataforseoBacklinks: number | null;
    dataforseoReferringPages: number | null;
    dataforseoFetchedAt: Date | null;
  }> = [];

  try {
    rows = await prisma.domainMetric.findMany({
      where: { domain: { in: cleaned } },
      select: {
        domain: true,
        dataforseoRank: true,
        referringDomains: true,
        dataforseoBacklinks: true,
        dataforseoReferringPages: true,
        dataforseoFetchedAt: true,
      },
    });
  } catch {
    rows = [];
  }

  const fresh = new Set<string>();
  const stale: string[] = [];

  for (const domain of cleaned) {
    const row = rows.find((r) => r.domain === domain);
    const ttl =
      row?.dataforseoRank != null ? DFS_SUCCESS_TTL_MS : DFS_EMPTY_TTL_MS;
    if (
      !opts.force &&
      row &&
      row.dataforseoFetchedAt &&
      isFresh(row.dataforseoFetchedAt, ttl)
    ) {
      fresh.add(domain);
      out.set(domain, {
        domain,
        rank: row.dataforseoRank,
        backlinks: row.dataforseoBacklinks,
        referringDomains: row.referringDomains,
        referringPages: row.dataforseoReferringPages,
        spamScore: null,
        fetchedAt: row.dataforseoFetchedAt,
        fromCache: true,
        cost: 0,
      });
    } else {
      stale.push(domain);
    }
  }

  if (fresh.size > 0) {
    recordUsage({
      endpoint: "backlinks/bulk_ranks/live",
      requestCount: 0,
      responseRows: fresh.size,
      estimatedCost: 0,
      cacheHit: true,
    });
  }

  if (stale.length === 0) return out;

  let bulk: { rows: DataForSeoRankRow[]; cost: number };
  try {
    bulk = await fetchBulkRanks(stale, { fetchImpl: opts.fetchImpl });
  } catch (err) {
    if (err instanceof DataForSeoError && err.code === "unauthorized") {
      // Do not write long-lived cache on auth failure.
      throw err;
    }
    // Soft-fail: return whatever we already had from cache.
    return out;
  }

  recordUsage({
    endpoint: "backlinks/bulk_ranks/live",
    requestCount: 1,
    responseRows: bulk.rows.length,
    estimatedCost: bulk.cost,
    cacheHit: false,
  });

  const now = new Date();
  for (const row of bulk.rows) {
    out.set(row.target, {
      domain: row.target,
      rank: row.rank,
      backlinks: null,
      referringDomains: null,
      referringPages: null,
      spamScore: null,
      fetchedAt: now,
      fromCache: false,
      cost: bulk.cost / Math.max(1, bulk.rows.length),
    });

    try {
      await prisma.domainMetric.upsert({
        where: { domain: row.target },
        create: {
          domain: row.target,
          dataforseoRank: row.rank,
          dataforseoFetchedAt: now,
          linkDataRelease: "DataForSEO bulk_ranks",
          fetchedAt: now,
        },
        update: {
          dataforseoRank: row.rank,
          dataforseoFetchedAt: now,
          linkDataRelease: "DataForSEO bulk_ranks",
        },
      });
    } catch {
      // Ranking still returns without a durable cache write.
    }
  }

  return out;
}

/**
 * Full backlink summary for one domain — used for competitor detail, not every SERP cell.
 */
export async function getCachedBacklinkSummary(
  domain: string,
  opts: { fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<CachedDomainAuthority | null> {
  if (!dataForSeoConfigured()) return null;
  const target = normalizeTarget(domain);
  if (target === "") return null;

  try {
    const existing = await prisma.domainMetric.findUnique({
      where: { domain: target },
      select: {
        dataforseoRank: true,
        dataforseoBacklinks: true,
        dataforseoReferringPages: true,
        referringDomains: true,
        dataforseoFetchedAt: true,
        linkDataRelease: true,
      },
    });

    const hasSummary =
      existing?.dataforseoBacklinks != null ||
      (existing?.linkDataRelease ?? "").includes("summary");
    if (
      !opts.force &&
      existing?.dataforseoFetchedAt &&
      hasSummary &&
      isFresh(existing.dataforseoFetchedAt, DFS_SUCCESS_TTL_MS)
    ) {
      recordUsage({
        endpoint: "backlinks/summary/live",
        requestCount: 0,
        responseRows: 1,
        estimatedCost: 0,
        cacheHit: true,
      });
      return {
        domain: target,
        rank: existing.dataforseoRank,
        backlinks: existing.dataforseoBacklinks,
        referringDomains: existing.referringDomains,
        referringPages: existing.dataforseoReferringPages,
        spamScore: null,
        fetchedAt: existing.dataforseoFetchedAt,
        fromCache: true,
        cost: 0,
      };
    }
  } catch {
    // continue to live fetch
  }

  let summary: DataForSeoBacklinkSummary;
  let cost: number;
  try {
    const live = await fetchBacklinkSummary(target, { fetchImpl: opts.fetchImpl });
    summary = live.summary;
    cost = live.cost;
  } catch (err) {
    if (err instanceof DataForSeoError && err.code === "unauthorized") throw err;
    return null;
  }

  recordUsage({
    endpoint: "backlinks/summary/live",
    requestCount: 1,
    responseRows: 1,
    estimatedCost: cost,
    cacheHit: false,
  });

  const now = new Date();
  try {
    await prisma.domainMetric.upsert({
      where: { domain: target },
      create: {
        domain: target,
        dataforseoRank: summary.rank,
        dataforseoBacklinks: summary.backlinks,
        dataforseoReferringPages: summary.referringPages,
        referringDomains: summary.referringDomains,
        dataforseoFetchedAt: now,
        linkDataRelease: "DataForSEO summary",
        linkDataFetchedAt: now,
        fetchedAt: now,
      },
      update: {
        dataforseoRank: summary.rank,
        dataforseoBacklinks: summary.backlinks,
        dataforseoReferringPages: summary.referringPages,
        referringDomains: summary.referringDomains,
        dataforseoFetchedAt: now,
        linkDataRelease: "DataForSEO summary",
        linkDataFetchedAt: now,
      },
    });
  } catch {
    // ignore cache write failure
  }

  return {
    domain: target,
    rank: summary.rank,
    backlinks: summary.backlinks,
    referringDomains: summary.referringDomains,
    referringPages: summary.referringPages,
    spamScore: summary.spamScore,
    fetchedAt: now,
    fromCache: false,
    cost,
  };
}
