/**
 * Everything Foresight knows about a project, gathered once.
 *
 * Two reasons this is a single loader rather than queries scattered through the
 * engine. It keeps the cost honest — one pass over data the app already has,
 * no provider calls, so the whole forecast can be recomputed on every render
 * without spending a cent. And it makes the maths testable: every model below
 * this file is a pure function over this object, so a scenario can be checked
 * against fixed evidence instead of against a database.
 *
 * Nothing here fetches. If a source has never been synced, its field comes back
 * empty and the models downstream report the gap rather than filling it.
 */

import { prisma } from "@/lib/db";
import { toPath } from "@/lib/google/performance";
import { SERP_FEATURES, type SerpFeature } from "@/lib/foresight/serp-features";
import type { DailyPoint } from "@/lib/foresight/trend";

export type QueryEvidence = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** Days of data behind this row. */
  days: number;
};

export type PageEvidence = {
  path: string;
  url: string;
  title: string;
  wordCount: number;
  internalLinks: number;
  indexable: boolean;
  issueCount: number;
  blockingIssues: number;
  clicks: number;
  impressions: number;
  position: number;
};

export type SerpEvidence = {
  query: string;
  features: SerpFeature[];
  /** Where this site appears, when it does. */
  ownPosition: number | null;
  competitors: {
    position: number;
    domain: string;
    url: string;
    wordCount: number;
    domainAuthority: number | null;
    pageAuthority: number | null;
    domainLinkingDomains: number | null;
  }[];
};

export type RankHistoryEvidence = {
  keyword: string;
  /** Positions oldest first. Nulls dropped — an unranked check is not a position. */
  positions: number[];
  volume: number;
};

export type Evidence = {
  projectId: string;
  siteUrl: string;
  siteHost: string;

  /** Daily Search Console rows, for the trend engine. Empty when unconnected. */
  daily: DailyPoint[];
  queries: QueryEvidence[];
  pages: PageEvidence[];
  serps: SerpEvidence[];
  rankHistory: RankHistoryEvidence[];

  /** Published pages on the site, for topical depth. */
  contentTitles: string[];
  domainAuthority: number | null;

  dataCutoff: string | null;
  historyDays: number;

  /**
   * Words that make a query navigational for this site.
   *
   * Needed because a brand search is not an opportunity: "cinnamon snail" and
   * "cinnamonsnail.com" are people looking for a site they have already
   * decided to visit, and a plan whose top four items are "win the People Also
   * Ask box for your own name" is not a plan.
   */
  brandTerms: string[];

  /** Connection facts the readiness gate needs, gathered in the same pass. */
  gscConnected: boolean;
  gscSyncedAt: Date | null;
  totalImpressions: number;
  rankChecks: number;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  }
}

type CachedSerpRow = {
  query: string;
  organic: { p: number | null; l: string | null; s: string | null }[] | null;
  features: Record<string, boolean> | null;
};

/**
 * Reads the cached SERPs, without reading the cached SERPs.
 *
 * The obvious version of this — `findMany({ select: { query, payload } })` —
 * pulled 12 MB of provider JSON across the wire, and the feature model then
 * ran the identical query and pulled it again. Twenty-four megabytes, twice a
 * second while somebody drags a slider, for perhaps 40 KB of facts.
 *
 * So the extraction happens in Postgres: three fields per organic result and a
 * boolean per feature. The feature names are compile-time constants from
 * `SERP_FEATURES`, never user input, which is what makes the generated SQL
 * safe — and the emptiness checks are explicit because an `ads: []` key means
 * the provider looked and found none, not that the SERP carries ads.
 */
async function loadCachedSerps(): Promise<CachedSerpRow[]> {
  const featureCases = SERP_FEATURES.map(
    (f) =>
      `'${f}', (payload -> '${f}') IS NOT NULL
        AND (payload -> '${f}') <> 'null'::jsonb
        AND (payload -> '${f}') <> '[]'::jsonb
        AND (payload -> '${f}') <> '{}'::jsonb`,
  ).join(",\n      ");

  const sql = `
    SELECT
      query,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'p', o -> 'position',
          'l', o -> 'link',
          's', left(o ->> 'snippet', 300)
        ))
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(payload -> 'organic_results') = 'array'
               THEN payload -> 'organic_results'
               ELSE '[]'::jsonb END
        ) o
      ) AS organic,
      jsonb_build_object(
      ${featureCases}
      ) AS features
    FROM "SerpCache"
    WHERE engine = 'google'
  `;

  return prisma.$queryRawUnsafe<CachedSerpRow[]>(sql);
}

export async function loadEvidence(
  projectId: string,
  siteUrl: string,
): Promise<Evidence> {
  const siteHost = hostOf(siteUrl);

  const [project, gscDaily, gscQueries, gscPages, audit, wpPosts, tracked, cachedSerps] =
    await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: { gscSiteUrl: true, gscSyncedAt: true, name: true },
      }),
      prisma.gscPageMetric.groupBy({
        by: ["date"],
        where: { projectId },
        _sum: { clicks: true, impressions: true },
      }),
      prisma.gscQueryMetric.findMany({
        where: { projectId },
        select: {
          query: true,
          clicks: true,
          impressions: true,
          position: true,
          date: true,
        },
      }),
      prisma.gscPageMetric.findMany({
        where: { projectId },
        select: {
          page: true,
          clicks: true,
          impressions: true,
          position: true,
        },
      }),
      prisma.audit.findFirst({
        where: { projectId, status: "completed" },
        orderBy: { finishedAt: "desc" },
        select: {
          id: true,
          pages: {
            select: {
              url: true,
              path: true,
              title: true,
              wordCount: true,
              internalLinkCount: true,
              indexable: true,
              issueCodes: true,
              status: true,
            },
          },
        },
      }),
      prisma.wpPost.findMany({
        where: { projectId, status: "publish" },
        select: { title: true },
        take: 2_000,
      }),
      prisma.trackedKeyword.findMany({
        where: { projectId },
        select: {
          keyword: true,
          volume: true,
          snapshots: {
            orderBy: { checkedAt: "asc" },
            select: { rank: true },
          },
        },
      }),
      loadCachedSerps(),
    ]);

  /*
   * Daily totals for the trend model. Positions are impression-weighted at the
   * page level already, so a simple site-wide average would be misleading; the
   * trend engine only needs clicks and impressions, and position is carried at
   * the query level where it means something.
   */
  const daily: DailyPoint[] = gscDaily
    .map((d) => ({
      date: d.date,
      clicks: d._sum.clicks ?? 0,
      impressions: d._sum.impressions ?? 0,
      position: 0,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Query rows arrive per day; the models want one row per query across the
  // whole window, with position weighted by the impressions behind it.
  const byQuery = new Map<
    string,
    { clicks: number; impressions: number; weighted: number; days: Set<string> }
  >();
  for (const row of gscQueries) {
    const key = row.query.toLowerCase().trim();
    const agg = byQuery.get(key) ?? {
      clicks: 0,
      impressions: 0,
      weighted: 0,
      days: new Set<string>(),
    };
    agg.clicks += row.clicks;
    agg.impressions += row.impressions;
    agg.weighted += row.position * row.impressions;
    agg.days.add(row.date.toISOString().slice(0, 10));
    byQuery.set(key, agg);
  }

  const queries: QueryEvidence[] = [...byQuery.entries()]
    .map(([query, a]) => ({
      query,
      clicks: a.clicks,
      impressions: a.impressions,
      ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
      position: a.impressions > 0 ? a.weighted / a.impressions : 0,
      days: a.days.size,
    }))
    .sort((a, b) => b.impressions - a.impressions);

  const perfByPath = new Map<string, { clicks: number; impressions: number; weighted: number }>();
  for (const row of gscPages) {
    const path = toPath(row.page);
    const agg = perfByPath.get(path) ?? { clicks: 0, impressions: 0, weighted: 0 };
    agg.clicks += row.clicks;
    agg.impressions += row.impressions;
    agg.weighted += row.position * row.impressions;
    perfByPath.set(path, agg);
  }

  /*
   * A page that returns an error or is flagged non-indexable cannot rank
   * whatever else is true of it, so those codes are separated from ordinary
   * issues rather than counted alongside them.
   */
  const BLOCKING = new Set(["noindex", "blocked_by_robots", "broken_page", "redirect_chain"]);

  const pages: PageEvidence[] = (audit?.pages ?? []).map((p) => {
    const perf = perfByPath.get(p.path);
    return {
      path: p.path,
      url: p.url,
      title: p.title,
      wordCount: p.wordCount,
      internalLinks: p.internalLinkCount,
      indexable: p.indexable && p.status < 400,
      issueCount: p.issueCodes.length,
      blockingIssues: p.issueCodes.filter((c) => BLOCKING.has(c)).length,
      clicks: perf?.clicks ?? 0,
      impressions: perf?.impressions ?? 0,
      position: perf !== undefined && perf.impressions > 0 ? perf.weighted / perf.impressions : 0,
    };
  });

  const serps: SerpEvidence[] = [];
  for (const row of cachedSerps) {
    const query = row.query.split("?")[0]!.toLowerCase().trim();
    if (query === "") continue;

    const organic = row.organic ?? [];
    if (organic.length === 0) continue;

    let ownPosition: number | null = null;
    const competitors: SerpEvidence["competitors"] = [];

    for (const r of organic) {
      const link = r.l ?? "";
      if (link === "") continue;
      const domain = hostOf(link);
      const position = typeof r.p === "number" ? r.p : competitors.length + 1;

      if (siteHost !== "" && domain === siteHost) {
        if (ownPosition === null) ownPosition = position;
        continue;
      }

      competitors.push({
        position,
        domain,
        url: link,
        // Snippet length is the only content signal a SERP response carries.
        // It is a weak proxy and is labelled as such wherever it surfaces.
        wordCount: (r.s ?? "").split(/\s+/).filter(Boolean).length * 40,
        domainAuthority: null,
        pageAuthority: null,
        domainLinkingDomains: null,
      });
    }

    const features = SERP_FEATURES.filter((f) => row.features?.[f] === true);
    serps.push({ query, features, ownPosition, competitors });
  }

  /*
   * Authority for the competing domains, read from the metrics table rather
   * than fetched. Domains never looked up stay null, and the reachability model
   * reports the gap as unknown instead of assuming parity.
   */
  const competitorDomains = [
    ...new Set(serps.flatMap((s) => s.competitors.map((c) => c.domain))),
  ].slice(0, 500);

  const metrics = await prisma.domainMetric.findMany({
    where: { domain: { in: competitorDomains } },
    select: { domain: true, snailyDa: true, referringDomains: true },
  });
  const daByDomain = new Map(metrics.map((m) => [m.domain, m]));

  for (const serp of serps) {
    for (const c of serp.competitors) {
      const m = daByDomain.get(c.domain);
      if (m === undefined) continue;
      c.domainAuthority = m.snailyDa;
      c.domainLinkingDomains = m.referringDomains;
    }
  }

  const rankHistory: RankHistoryEvidence[] = tracked.map((t) => ({
    keyword: t.keyword.toLowerCase(),
    positions: t.snapshots
      .map((s) => s.rank)
      .filter((r): r is number => r !== null),
    volume: t.volume,
  }));

  /*
   * This site's own authority, read from the cached metrics table rather than
   * looked up. `getDomainAuthority` will happily go and fetch OpenPageRank and
   * Common Crawl for a domain it has not seen, and Foresight recomputes on
   * every render — so calling it here would turn a free intelligence layer into
   * a background source of provider spend. Null when the domain was never
   * looked up, which the reachability model reports as an unknown gap.
   */
  const own = await prisma.domainMetric.findUnique({
    where: { domain: siteHost },
    select: { snailyDa: true },
  });

  const dates = daily.map((d) => d.date.getTime());
  const dataCutoff =
    dates.length === 0 ? null : new Date(Math.max(...dates)).toISOString().slice(0, 10);
  const historyDays =
    dates.length === 0
      ? 0
      : Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000) + 1;

  /*
   * Whole names only — never the individual words in them. Splitting "Cinnamon
   * Snail" into "cinnamon" and "snail" would classify "cinnamon rolls recipe"
   * as a navigational search for the brand and quietly delete one of the site's
   * best opportunities. A brand term has to be the brand.
   */
  const brandTerms = [
    ...new Set(
      [siteHost, siteHost.split(".")[0] ?? "", (project?.name ?? "").toLowerCase()]
        .map((t) => t.trim())
        .filter((t) => t.length >= 4),
    ),
  ];

  return {
    projectId,
    siteUrl,
    siteHost,
    brandTerms,
    gscConnected: (project?.gscSiteUrl ?? null) !== null,
    gscSyncedAt: project?.gscSyncedAt ?? null,
    totalImpressions: queries.reduce((s, q) => s + q.impressions, 0),
    rankChecks: rankHistory.reduce((s, r) => s + r.positions.length, 0),
    daily,
    queries,
    pages,
    serps,
    rankHistory,
    contentTitles: wpPosts.map((w) => w.title),
    domainAuthority: own?.snailyDa ?? null,
    dataCutoff,
    historyDays,
  };
}
