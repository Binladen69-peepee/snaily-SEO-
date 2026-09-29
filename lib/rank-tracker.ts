import { recordRankMovement } from "@/lib/alerts";
import { reportError } from "@/lib/errors";
import { dataForSeoConfigured } from "@/lib/dataforseo/config";
import { prisma } from "@/lib/db";
import { estimateKeyword } from "@/lib/keywords/estimate";
import { hydrateKeywords, keywordMap } from "@/lib/keywords/hydrate";
import { getNormalizedSerp } from "@/lib/keywords/get-normalized-serp";
import { serpApiConfigured } from "@/lib/keywords/serp-api-guard";

/**
 * Positions are measured against the live SERP (DataForSEO primary, SerpApi
 * fallback). Search Console averages remain available as a free secondary
 * signal where imported. A nightly cron samples a small batch; full checks
 * stay on the Rank Tracker page.
 */

export const ENGINES = [
  { value: "google.com", label: "Google.com", country: "us" },
  { value: "google.co.uk", label: "Google.co.uk", country: "uk" },
  { value: "google.ca", label: "Google.ca", country: "ca" },
  { value: "google.com.au", label: "Google.com.au", country: "au" },
  { value: "google.de", label: "Google.de", country: "de" },
  { value: "google.fr", label: "Google.fr", country: "fr" },
  { value: "google.co.in", label: "Google.co.in", country: "in" },
] as const;

export type TrackedRow = {
  id: string;
  keyword: string;
  engine: string;
  country: string;
  location: string | null;
  groupName: string | null;
  volume: number;
  /** Latest measured position, null when not in the top 100. */
  rank: number | null;
  /** Positions gained since the previous check. Positive is an improvement. */
  change: number | null;
  /** The ranking URL, when found. */
  url: string | null;
  checkedAt: string | null;
  source: string | null;
  /** Oldest → newest, for the inline history chart. */
  history: { date: string; rank: number | null }[];
};

export type TrackerSummary = {
  total: number;
  top3: number;
  top10: number;
  top100: number;
  notSeen: number;
  improved: number;
  declined: number;
  /** Sum of positions gained across every keyword — KeySearch's "net rank change". */
  netChange: number;
  /** Mean position across keywords that rank at all. */
  averageRank: number | null;
};

/** Positions beyond this are reported as "not seen" rather than a number. */
const MAX_RANK = 100;

export async function listTracked(
  projectId: string,
  userId: string,
): Promise<TrackedRow[]> {
  const rows = await prisma.trackedKeyword.findMany({
    where: { projectId, userId },
    orderBy: { createdAt: "desc" },
    include: {
      snapshots: { orderBy: { checkedAt: "desc" }, take: 30 },
    },
  });

  return rows.map((k) => {
    const [latest, previous] = k.snapshots;

    // Improving means the number goes *down*, so the sign is flipped to make
    // "up" mean "better" everywhere in the UI.
    const change =
      latest?.rank != null && previous?.rank != null
        ? previous.rank - latest.rank
        : null;

    return {
      id: k.id,
      keyword: k.keyword,
      engine: k.engine,
      country: k.country,
      location: k.location,
      groupName: k.groupName,
      volume: k.volume,
      rank: latest?.rank ?? null,
      change,
      url: latest?.url ?? null,
      checkedAt: latest?.checkedAt.toISOString() ?? null,
      source: latest?.source ?? null,
      history: [...k.snapshots]
        .reverse()
        .map((s) => ({ date: s.checkedAt.toISOString(), rank: s.rank })),
    };
  });
}

export function summarise(rows: TrackedRow[]): TrackerSummary {
  const ranked = rows.filter((r) => r.rank !== null);

  return {
    total: rows.length,
    top3: rows.filter((r) => r.rank !== null && r.rank <= 3).length,
    top10: rows.filter((r) => r.rank !== null && r.rank <= 10).length,
    top100: ranked.length,
    notSeen: rows.length - ranked.length,
    improved: rows.filter((r) => (r.change ?? 0) > 0).length,
    declined: rows.filter((r) => (r.change ?? 0) < 0).length,
    netChange: rows.reduce((sum, r) => sum + (r.change ?? 0), 0),
    averageRank:
      ranked.length === 0
        ? null
        : Math.round(
            (ranked.reduce((s, r) => s + (r.rank ?? 0), 0) / ranked.length) * 10,
          ) / 10,
  };
}

/** Domain of a project URL, without protocol or www. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
  }
}

/** Best position for a domain inside normalized organic results. */
function findDomain(
  organic: { position: number; url: string; domain: string }[],
  domain: string,
): { rank: number; url: string } | null {
  let best: { rank: number; url: string } | null = null;
  const target = domain.replace(/^www\./, "").toLowerCase();

  for (const r of organic) {
    const host = r.domain.replace(/^www\./, "").toLowerCase();
    if (host !== target && !host.endsWith(`.${target}`)) continue;
    if (r.position > MAX_RANK) continue;
    if (best === null || r.position < best.rank) {
      best = { rank: r.position, url: r.url };
    }
  }

  return best;
}

/**
 * Measures live positions for a set of tracked keywords and records them.
 *
 * Each keyword is one SERP lookup (DataForSEO primary). Cached SERPs cost
 * nothing. Caller decides when to spend.
 */
export async function checkRanks(
  keywordIds: string[],
  domain: string,
): Promise<{ checked: number; ranked: number; error?: string }> {
  if (!dataForSeoConfigured() && !serpApiConfigured()) {
    return {
      checked: 0,
      ranked: 0,
      error:
        "Live rank checks need DataForSEO or SerpApi credentials in the environment.",
    };
  }

  const keywords = await prisma.trackedKeyword.findMany({
    where: { id: { in: keywordIds } },
  });

  let ranked = 0;

  for (const k of keywords) {
    const previous = await prisma.rankSnapshot.findFirst({
      where: { keywordId: k.id },
      orderBy: { checkedAt: "desc" },
      select: { rank: true },
    });

    let found: { rank: number; url: string } | null = null;
    try {
      /*
       * Use the engine's mapped country when present, otherwise fall back to
       * the keyword's stored country. Location (city/region) is passed through
       * for providers that support localised SERPs (DataForSEO does).
       */
      const engineEntry = ENGINES.find((e) => e.value === k.engine);
      const serpCountry = engineEntry?.country ?? k.country;

      const serp = await getNormalizedSerp({
        keyword: k.keyword,
        country: serpCountry,
        location: k.location ?? undefined,
        depth: MAX_RANK,
        preferProvider: "dataforseo",
      });
      found = findDomain(serp.organicResults, domain);
    } catch (err) {
      await reportError({
        route: "rank-check",
        message:
          err instanceof Error
            ? `Rank check failed for "${k.keyword}": ${err.message}`
            : `Rank check failed for "${k.keyword}"`,
      });
      continue;
    }

    await prisma.rankSnapshot.create({
      data: {
        keywordId: k.id,
        rank: found?.rank ?? null,
        url: found?.url ?? null,
        source: "serp",
      },
    });

    await recordRankMovement({
      projectId: k.projectId,
      userId: k.userId,
      keywordId: k.id,
      keyword: k.keyword,
      previousRank: previous?.rank ?? null,
      currentRank: found?.rank ?? null,
    });

    if (found !== null) ranked++;
  }

  return { checked: keywords.length, ranked };
}

/** Hobby 60s + DFS cost: one cron run only samples a handful. */
const MAX_CRON_CHECKS = 8;

/**
 * Tracked keywords that have not had a live SERP snapshot today, oldest first.
 */
export async function pickKeywordsDueForCheck(): Promise<
  { projectId: string; url: string; ids: string[] }[]
> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const projects = await prisma.project.findMany({
    select: { id: true, url: true },
    take: 20,
  });

  const batches: { projectId: string; url: string; ids: string[] }[] = [];
  let remaining = MAX_CRON_CHECKS;

  for (const project of projects) {
    if (remaining <= 0) break;
    const due = await prisma.trackedKeyword.findMany({
      where: {
        projectId: project.id,
        snapshots: {
          none: { checkedAt: { gte: since }, source: "serp" },
        },
      },
      select: { id: true },
      take: remaining,
      orderBy: { updatedAt: "asc" },
    });
    if (due.length === 0) continue;
    batches.push({
      projectId: project.id,
      url: project.url,
      ids: due.map((d) => d.id),
    });
    remaining -= due.length;
  }

  return batches;
}

/**
 * Adds keywords to tracking, skipping ones already followed.
 *
 * Volume is estimated once at add time so the table can render without a
 * per-row lookup.
 */
export async function addKeywords(
  userId: string,
  projectId: string,
  keywords: string[],
  engine: string,
  country: string,
  location: string | null,
  groupName: string | null,
): Promise<number> {
  const clean = [
    ...new Set(
      keywords
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k !== "" && k.length <= 200),
    ),
  ];

  let added = 0;
  const live = keywordMap(await hydrateKeywords(clean, country));
  for (const keyword of clean) {
    const est = live.get(keyword) ?? estimateKeyword(keyword, country);
    try {
      await prisma.trackedKeyword.create({
        data: {
          userId,
          projectId,
          keyword,
          engine,
          country,
          location,
          groupName,
          volume: est.volume,
        },
      });
      added++;
    } catch {
      // Unique constraint — already tracked on this engine and country.
    }
  }

  return added;
}

/**
 * Keywords the project already ranks for, from Search Console.
 *
 * Powers KeySearch's "We've Found Keywords!" — suggestions drawn from data
 * Google already has, so nothing is spent discovering them. Returns an empty
 * list when Search Console has not been synced, which the UI explains.
 */
export async function discoverKeywords(
  projectId: string,
  limit = 50,
): Promise<{ keyword: string; position: number; impressions: number }[]> {
  const since = new Date();
  since.setDate(since.getDate() - 28);

  const rows = await prisma.gscQueryMetric.groupBy({
    by: ["query"],
    where: { projectId, date: { gte: since } },
    _sum: { impressions: true },
    _avg: { position: true },
    orderBy: { _sum: { impressions: "desc" } },
    take: limit,
  });

  const tracked = new Set(
    (
      await prisma.trackedKeyword.findMany({
        where: { projectId },
        select: { keyword: true },
      })
    ).map((t) => t.keyword),
  );

  return rows
    .filter((r) => !tracked.has(r.query.toLowerCase()))
    .map((r) => ({
      keyword: r.query,
      position: Math.round((r._avg.position ?? 0) * 10) / 10,
      impressions: r._sum.impressions ?? 0,
    }));
}

/**
 * Records Search Console's own average position for every tracked keyword.
 *
 * Free and unlimited — Google already measured it — so this runs alongside the
 * live SERP checks rather than replacing them. Snapshots are tagged
 * "search-console" so the two sources stay distinguishable in the history.
 */
export async function importSearchConsoleRanks(
  projectId: string,
  userId: string,
): Promise<{ imported: number }> {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const tracked = await prisma.trackedKeyword.findMany({
    where: { projectId, userId },
    select: { id: true, keyword: true },
  });
  if (tracked.length === 0) return { imported: 0 };

  const rows = await prisma.gscQueryMetric.groupBy({
    by: ["query"],
    where: {
      projectId,
      date: { gte: since },
      query: { in: tracked.map((t) => t.keyword) },
    },
    _avg: { position: true },
  });

  const byQuery = new Map(
    rows.map((r) => [r.query.toLowerCase(), r._avg.position ?? null]),
  );

  let imported = 0;
  for (const k of tracked) {
    const position = byQuery.get(k.keyword.toLowerCase());
    if (position === undefined || position === null) continue;

    await prisma.rankSnapshot.create({
      data: {
        keywordId: k.id,
        rank: Math.round(position),
        source: "search-console",
      },
    });
    imported++;
  }

  return { imported };
}
