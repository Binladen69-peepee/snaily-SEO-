import { prisma } from "@/lib/db";
import { estimateKeyword } from "@/lib/keywords/estimate";
import { serpFetch } from "@/lib/keywords/providers/serpapi";

/**
 * Rank tracking.
 *
 * Positions are measured against the live SERP, which is what a rank tracker
 * is for: Search Console reports an *average* position across every impression,
 * so a keyword sitting at 3 in the US and 40 elsewhere averages to something
 * that matches neither. Where Search Console data exists it is still imported,
 * clearly labelled, because it is free and covers keywords nobody thought to
 * track.
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

type SerpPayload = {
  error?: string;
  organic_results?: { position?: number; link?: string }[];
};

/** Best position for a domain inside one SERP payload, with its URL. */
function findDomain(
  payload: SerpPayload,
  domain: string,
): { rank: number; url: string } | null {
  let best: { rank: number; url: string } | null = null;

  for (const r of payload.organic_results ?? []) {
    const link = r.link ?? "";
    let host = "";
    try {
      host = new URL(link).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;

    const rank = r.position;
    if (typeof rank !== "number" || rank > MAX_RANK) continue;
    if (best === null || rank < best.rank) best = { rank, url: link };
  }

  return best;
}

/**
 * Measures live positions for a set of tracked keywords and records them.
 *
 * Each keyword is one SerpApi search, so the caller decides when to spend —
 * nothing here runs on a schedule. Cached SERPs cost nothing, which makes a
 * re-check within the cache window free.
 */
export async function checkRanks(
  keywordIds: string[],
  domain: string,
): Promise<{ checked: number; ranked: number; error?: string }> {
  const apiKey = (process.env.SERPAPI_KEY ?? "").trim();
  if (apiKey === "") {
    return {
      checked: 0,
      ranked: 0,
      error: "Live rank checks need SERPAPI_KEY in the environment.",
    };
  }

  const keywords = await prisma.trackedKeyword.findMany({
    where: { id: { in: keywordIds } },
  });

  let ranked = 0;

  // Sequential: a burst of parallel searches is what SerpApi rate-limits, and
  // this runs over a handful of keywords.
  for (const k of keywords) {
    const extra: Record<string, string> = { num: "100" };
    if (k.location !== null && k.location !== "") extra.location = k.location;

    let found: { rank: number; url: string } | null = null;
    try {
      const payload = await serpFetch<SerpPayload>(
        apiKey,
        "google",
        k.keyword,
        k.country,
        extra,
      );
      found = findDomain(payload, domain);
    } catch {
      // One bad keyword must not abandon the rest of the batch.
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

    if (found !== null) ranked++;
  }

  return { checked: keywords.length, ranked };
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
  for (const keyword of clean) {
    const est = estimateKeyword(keyword, country);
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
