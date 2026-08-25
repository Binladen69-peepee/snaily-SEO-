import { crawlSite } from "@/lib/audit/crawler";
import { prisma } from "@/lib/db";
import { estimateTraffic } from "@/lib/keywords/ctr";
import { estimateKeyword } from "@/lib/keywords/estimate";
import { dataForSeoConfigured, getCachedBacklinkSummary } from "@/lib/dataforseo";
import { getNormalizedSerp } from "@/lib/keywords/get-normalized-serp";
import { serpApiConfigured } from "@/lib/keywords/serp-api-guard";
import { getDomainAuthority } from "@/lib/metrics/authority";
import { readCitations } from "@/lib/metrics/citations";
import { getCachedLinkCounts, getLinkProfile } from "@/lib/metrics/link-data";
import { scoreLinkCounts } from "@/lib/metrics/link-counts";
import { scorePage } from "@/lib/metrics/page-authority";
import { readPage, type PageContent } from "@/lib/optimizer";
import { extractTerms, type TermCount } from "@/lib/text";
import type { Keyword } from "@/lib/keywords/types";

/**
 * Competitive analysis without a paid keyword index.
 *
 * The honest boundary, stated once here and surfaced in the UI on every screen
 * that depends on it:
 *
 *  - What a site *targets* is measurable. We crawl it and read the titles, H1s
 *    and meta descriptions its author wrote. That is fact.
 *  - What a site *ranks for* is only measurable for your own domain, via
 *    Search Console. For anyone else's domain it needs a domain→keyword
 *    database (DataForSEO Labs and friends), which is a purchase, not code.
 *
 * So: your own site reports real rankings; competitors report real targeting
 * with estimated volume and difficulty, and every screen says which it is.
 */

/** Crawling more than this makes the page slow without changing conclusions. */
const MAX_CRAWL_PAGES = 24;

export type DomainPage = {
  url: string;
  path: string;
  title: string;
  metaDescription: string;
  h1: string;
  words: number;
  /** Internal links pointing *at* this page — how the site ranks its own content. */
  inboundLinks: number;
  /** Internal links this page points out to. */
  outboundLinks: number;
  status: number;
};

export type DomainProfile = {
  domain: string;
  origin: string;
  pages: DomainPage[];
  /** Distinct internal URLs discovered, including ones the page cap skipped. */
  pagesFound: number;
  /** URLs fetched that returned an error or non-HTML body. */
  pagesFailed: number;
  medianWords: number;
  totalWords: number;
  /** Phrases the site's own titles and headings target. */
  keywords: Keyword[];
  topics: TermCount[];
  missingTitles: number;
  missingMeta: number;
  thinPages: number;
  /**
   * Snaily Domain Authority, derived from free link-graph and SERP signals.
   * Link counts come from the same Common Crawl graph (see link-counts.ts).
   */
  authority: {
    domainAuthority: number | null;
    trust: number | null;
    domainLinkingDomains: number | null;
    backlinks: number | null;
  };
};

export type UrlMetrics = {
  page: PageContent;
  /** Round-trip time of the fetch, in milliseconds. */
  responseMs: number;
  https: boolean;
  /** Snaily scores and link counts from Common Crawl PageRank. */
  pageAuthority: number | null;
  domainAuthority: number | null;
  pageLinkingDomains: number | null;
  backlinks: number | null;
};

export type Mention = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
};

export type MentionReport = {
  domain: string;
  mentions: Mention[];
  /** Distinct domains among the citing pages found. Real, but citations only. */
  referringDomains: number;
  /** Snaily Domain Authority for the queried domain. Derived, never guessed. */
  authority: {
    domainAuthority: number | null;
    trust: number | null;
  };
  /** Domain-level inbound links from Common Crawl PageRank. */
  backlinks: number | null;
  /** Distinct linking domains from the same graph. */
  domainLinkingDomains: number | null;
  /** True when neither DataForSEO nor SerpApi is configured. */
  liveUnavailable: boolean;
};

/**
 * Pages that mention a domain but aren't on it.
 *
 * This is a citation check, not a backlink index — Google's `-site:` operator
 * finds pages that reference the domain, whether or not they link to it. It is
 * real, live data and useful for outreach; it is not a substitute for Ahrefs,
 * and the UI says so.
 */
export async function findMentions(domain: string): Promise<MentionReport> {
  const scored = (await getDomainAuthority([domain])).get(
    domain.replace(/^www\./, "").toLowerCase(),
  );
  const authority = {
    domainAuthority: scored?.score.value ?? null,
    trust: scored?.trust.value ?? null,
  };

  let graph = {
    backlinks: null as number | null,
    domainLinkingDomains: null as number | null,
  };

  if (dataForSeoConfigured()) {
    const summary = await getCachedBacklinkSummary(domain).catch(() => null);
    if (summary) {
      graph = {
        backlinks: summary.backlinks,
        domainLinkingDomains: summary.referringDomains,
      };
    }
  }

  if (graph.backlinks === null && graph.domainLinkingDomains === null) {
    const links = scoreLinkCounts({
      openPageRank: scored?.openPageRank ?? null,
      domainAuthority: scored?.score.value ?? null,
      measuredReferringDomains: scored?.referringDomains ?? null,
      url: `https://${domain}/`,
      pageAuthority: scored?.score.value ?? null,
      position: 1,
    });
    graph = {
      backlinks: links?.domainBacklinks ?? null,
      domainLinkingDomains: links?.domainLinkingDomains ?? null,
    };
  }

  if (!dataForSeoConfigured() && !serpApiConfigured()) {
    return {
      domain,
      mentions: [],
      referringDomains: 0,
      authority,
      ...graph,
      liveUnavailable: true,
    };
  }

  let mentions: Mention[] = [];
  try {
    const serp = await getNormalizedSerp({
      keyword: `"${domain}" -site:${domain}`,
      country: "us",
      depth: 10,
      preferProvider: "dataforseo",
    });
    mentions = serp.organicResults
      .map((r) => ({
        title: r.title,
        url: r.url,
        domain: r.domain,
        snippet: r.snippet,
      }))
      .filter((m) => m.url !== "" && m.domain !== domain);
  } catch {
    return {
      domain,
      mentions: [],
      referringDomains: 0,
      authority,
      ...graph,
      liveUnavailable: true,
    };
  }

  return {
    domain,
    mentions,
    referringDomains: new Set(mentions.map((m) => m.domain)).size,
    authority,
    ...graph,
    liveUnavailable: false,
  };
}

/** Accepts "example.com", "www.example.com/x" or a full URL. */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Crawls a domain and reports what it is built to rank for.
 *
 * Uses the same crawler as Site Audit — one bounded, polite, robots-respecting
 * pass — so there is no second crawler to maintain.
 */
export async function profileDomain(
  domain: string,
  country: string,
  maxPages = MAX_CRAWL_PAGES,
): Promise<DomainProfile> {
  const origin = `https://${domain}`;
  const { pages, discovered } = await crawlSite({ startUrl: origin, maxPages });

  const ok = pages.filter((p) => p.status >= 200 && p.status < 400);

  /*
   * Inbound internal links, counted from the crawl graph.
   *
   * The page list used to be ordered by each page's *outbound* link count
   * while being labelled "most linked-to", which is the opposite measure — a
   * long navigation-heavy page looked important purely for linking out a lot.
   * What signals a site's own priorities is how often it links *to* a page.
   */
  const inbound = new Map<string, number>();
  for (const page of ok) {
    for (const target of new Set(page.internalLinks)) {
      if (target === page.url) continue; // self-links say nothing
      inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
  }

  const list: DomainPage[] = ok.map((p) => ({
    url: p.url,
    path: pathOf(p.url),
    title: p.title,
    metaDescription: p.metaDescription,
    h1: p.h1[0] ?? "",
    words: p.wordCount,
    inboundLinks: inbound.get(p.url) ?? 0,
    outboundLinks: new Set(p.internalLinks).size,
    status: p.status,
  }));

  // A site's titles and H1s are the clearest statement of what it targets —
  // written deliberately by its author, not inferred.
  const targeting = ok.map(
    (p) => `${p.title} ${p.h1.join(" ")} ${p.metaDescription}`,
  );

  const phrases = [
    ...extractTerms(targeting, 3, 40),
    ...extractTerms(targeting, 2, 80),
  ]
    .sort((a, b) => b.documents - a.documents || b.count - a.count)
    /*
     * 25 was far too tight. A site's keyword set is the whole reason this
     * screen exists, and capping it there reported 20 phrases for a blog with
     * hundreds of posts — a limit of the sample, presented as a property of
     * the site.
     */
    .slice(0, 200);

  const words = list.map((p) => p.words).filter((w) => w > 0);
  const scored = (await getDomainAuthority([domain])).get(
    domain.replace(/^www\./, "").toLowerCase(),
  );
  const links = scoreLinkCounts({
    openPageRank: scored?.openPageRank ?? null,
    domainAuthority: scored?.score.value ?? null,
    url: origin,
    pageAuthority: scored?.score.value ?? null,
    position: 1,
  });

  return {
    domain,
    origin,
    pages: list.sort(
      (a, b) => b.inboundLinks - a.inboundLinks || b.words - a.words,
    ),
    pagesFound: discovered,
    pagesFailed: pages.length - ok.length,
    medianWords: median(words),
    totalWords: words.reduce((a, b) => a + b, 0),
    keywords: phrases.map((t) => estimateKeyword(t.term, country)),
    topics: extractTerms(targeting, 1, 20),
    missingTitles: list.filter((p) => p.title.trim() === "").length,
    missingMeta: list.filter((p) => p.metaDescription.trim() === "").length,
    thinPages: list.filter((p) => p.words > 0 && p.words < 300).length,
    authority: {
      domainAuthority: scored?.score.value ?? null,
      trust: scored?.trust.value ?? null,
      domainLinkingDomains: links?.domainLinkingDomains ?? null,
      backlinks: links?.domainBacklinks ?? null,
    },
  };
}

/** Real on-page metrics for one URL, measured by fetching it. */
export async function getUrlMetrics(url: string): Promise<UrlMetrics> {
  const started = Date.now();
  const page = await readPage(url);
  const responseMs = Date.now() - started;

  const scored = (await getDomainAuthority([page.domain])).get(
    page.domain.replace(/^www\./, "").toLowerCase(),
  );
  const pageScore = scorePage({ url: page.url, domain: scored });
  const links = scoreLinkCounts({
    openPageRank: scored?.openPageRank ?? null,
    domainAuthority: scored?.score.value ?? null,
    url: page.url,
    pageAuthority: pageScore.value,
    position: null,
  });

  return {
    page,
    responseMs,
    https: page.url.startsWith("https://"),
    pageAuthority: pageScore.value,
    domainAuthority: scored?.score.value ?? null,
    pageLinkingDomains: links?.pageLinkingDomains ?? null,
    backlinks: links?.backlinks ?? null,
  };
}

export type OrganicKeyword = {
  keyword: string;
  /** Measured position, or null when nothing has measured it yet. */
  position: number | null;
  /** Where `position` came from, so the UI never implies more than it knows. */
  positionSource: "search-console" | "serp" | null;
  clicks: number;
  impressions: number;
  ctr: number;
  volume: number;
  difficulty: number;
  cpc: number;
  /** Monthly visits implied by position × volume; null when unranked. */
  estTraffic: number | null;
};

/**
 * Ranking positions read out of SERPs we already fetched.
 *
 * Every keyword researched in this app leaves its first page in `SerpCache`.
 * Scanning those for a domain gives genuine positions for free — no extra API
 * credit and no guessing. Coverage is partial by nature: a keyword nobody has
 * researched yet simply has no position, and the UI shows that as unknown
 * rather than inventing a rank.
 */
async function positionsFromSerpCache(
  domain: string,
  keywords: string[],
  country: string,
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  if (keywords.length === 0) return found;

  const lowered = keywords.map((k) => k.toLowerCase());

  const rows = await prisma.serpCache.findMany({
    where: {
      country,
      OR: [
        { engine: "google", query: { in: lowered } },
        {
          engine: "serp_norm",
          // Normalized keys are `keyword|hl=…|depth=…|device=…`
          OR: lowered.map((k) => ({ query: { startsWith: `${k}|` } })),
        },
      ],
    },
    select: { query: true, engine: true, payload: true },
  });

  for (const row of rows) {
    let organic: { position: number; url: string; domain: string }[] = [];
    const payload = row.payload as {
      organicResults?: { position: number; url: string; domain: string }[];
      organic_results?: { position?: number; link?: string }[];
    };

    if (row.engine === "serp_norm" && Array.isArray(payload.organicResults)) {
      organic = payload.organicResults;
    } else if (Array.isArray(payload.organic_results)) {
      organic = payload.organic_results.map((r, i) => {
        const url = r.link ?? "";
        let host = "";
        try {
          host = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          host = "";
        }
        return {
          position: r.position ?? i + 1,
          url,
          domain: host,
        };
      });
    }

    const position = positionIn(organic, domain);
    if (position === null) continue;

    const keyword =
      row.engine === "serp_norm"
        ? row.query.split("|")[0]!.toLowerCase()
        : row.query.toLowerCase();
    const existing = found.get(keyword);
    if (existing === undefined || position < existing) {
      found.set(keyword, position);
    }
  }

  return found;
}

export type OrganicResult = {
  domain: string;
  /** "search-console" is measured; "crawl" is what the site targets. */
  source: "search-console" | "crawl";
  keywords: OrganicKeyword[];
  /** Set when source is "crawl". */
  profile?: DomainProfile;
};

/**
 * Real ranked keywords for a project, straight from Search Console.
 *
 * Returns null when the project has no synced Search Console data, so callers
 * can fall back to the crawl-derived view rather than showing an empty table.
 */
export async function getSearchConsoleKeywords(
  projectId: string,
  country: string,
  days = 28,
  limit = 200,
): Promise<OrganicKeyword[] | null> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.gscQueryMetric.groupBy({
    by: ["query"],
    where: { projectId, date: { gte: since } },
    _sum: { clicks: true, impressions: true },
    _avg: { position: true },
    orderBy: { _sum: { impressions: "desc" } },
    take: limit,
  });

  if (rows.length === 0) return null;

  return rows.map((r) => {
    const clicks = r._sum.clicks ?? 0;
    const impressions = r._sum.impressions ?? 0;
    // Volume, difficulty and CPC are not in Search Console — estimated.
    // The country has to be threaded through: hardcoding "us" here meant the
    // location selector silently did nothing on this screen.
    const est = estimateKeyword(r.query, country);
    const position =
      r._avg.position === null ? null : Math.round(r._avg.position * 10) / 10;

    return {
      keyword: r.query,
      position,
      positionSource: position === null ? null : ("search-console" as const),
      clicks,
      impressions,
      ctr: impressions === 0 ? 0 : clicks / impressions,
      volume: est.volume,
      difficulty: est.difficulty,
      cpc: est.cpc,
      estTraffic: estimateTraffic(position, est.volume),
    };
  });
}

/** Finds a domain's best position inside normalized organic results. */
function positionIn(
  organic: { position: number; url: string; domain: string }[],
  domain: string,
): number | null {
  let best: number | null = null;
  const target = domain.replace(/^www\./, "").toLowerCase();

  for (const result of organic) {
    const host = result.domain.replace(/^www\./, "").toLowerCase();
    if (host !== target && !host.endsWith(`.${target}`)) continue;
    if (best === null || result.position < best) best = result.position;
  }

  return best;
}

/**
 * Checks live ranking positions for a specific set of keywords.
 *
 * Opt-in because it spends real API credit: every keyword not already in the
 * cache costs one SERP lookup (DataForSEO primary, SerpApi fallback). Cached
 * keywords are free, and each lookup refills the cache.
 *
 * Keywords the domain does not rank for come back as null rather than being
 * omitted, so the caller can tell "checked, not ranking" from "not checked".
 */
export async function lookupPositions(
  domain: string,
  keywords: string[],
  country: string,
): Promise<Record<string, number | null>> {
  if (!dataForSeoConfigured() && !serpApiConfigured()) {
    throw new Error(
      "Live position checks need DataForSEO or SerpApi. Only cached positions are available.",
    );
  }

  const out: Record<string, number | null> = {};

  // Sequential on purpose — avoid bursting rate limits; at most ten keywords.
  for (const keyword of keywords) {
    try {
      const serp = await getNormalizedSerp({
        keyword,
        country,
        depth: 10,
        preferProvider: "dataforseo",
      });
      out[keyword] = positionIn(serp.organicResults, domain);
    } catch {
      out[keyword] = null;
    }
  }

  return out;
}

/**
 * Phrases the site's own published titles target, read from synced posts.
 *
 * Real content the author wrote, not a guess — and it covers the whole site
 * rather than the handful of pages a bounded crawl reaches.
 */
async function keywordsFromSyncedPosts(
  domain: string,
  country: string,
): Promise<Keyword[]> {
  try {
    const posts = await prisma.wpPost.findMany({
      where: { project: { url: { contains: domain } }, status: "publish" },
      select: { title: true, seoTitle: true, focusKeyword: true },
      take: 1_000,
    });
    if (posts.length === 0) return [];

    const corpus = posts.map((p) =>
      [p.title, p.seoTitle, p.focusKeyword].filter((v) => v !== "").join(" . "),
    );

    const phrases = [
      ...extractTerms(corpus, 3, 40),
      ...extractTerms(corpus, 2, 80),
    ]
      .sort((a, b) => b.documents - a.documents || b.count - a.count)
      .slice(0, 200);

    return phrases.map((t) => estimateKeyword(t.term, country));
  } catch {
    return [];
  }
}

export async function getOrganicKeywords(
  domain: string,
  country: string,
  projectId: string | null,
  projectDomain: string | null,
  /** Set false to force the crawl view even for your own domain. */
  allowSearchConsole = true,
): Promise<OrganicResult> {
  // Your own site has measured data; use it in preference to any inference.
  if (allowSearchConsole && projectId !== null && projectDomain === domain) {
    const gsc = await getSearchConsoleKeywords(projectId, country);
    if (gsc !== null) {
      return { domain, source: "search-console", keywords: gsc };
    }
  }

  const profile = await profileDomain(domain, country);

  /*
   * Fold in the site's synced posts.
   *
   * The crawl reads at most 24 pages, so for a blog with hundreds of them the
   * keyword set is a sample of the navigation rather than of the content. When
   * the site has been synced from WordPress every title is already in the
   * database, which is a far better corpus and costs nothing to read.
   */
  const synced = await keywordsFromSyncedPosts(domain, country);
  const merged = new Map(profile.keywords.map((k) => [k.keyword, k]));
  for (const k of synced) if (!merged.has(k.keyword)) merged.set(k.keyword, k);
  const allKeywords = [...merged.values()];

  // Free, real positions for anything already researched in this app.
  const cached = await positionsFromSerpCache(
    domain,
    allKeywords.map((k) => k.keyword),
    country,
  );

  return {
    domain,
    source: "crawl",
    profile,
    keywords: allKeywords.map((k) => {
      const position = cached.get(k.keyword.toLowerCase()) ?? null;
      return {
        keyword: k.keyword,
        position,
        positionSource: position === null ? null : ("serp" as const),
        clicks: 0,
        impressions: 0,
        ctr: 0,
        volume: k.volume,
        difficulty: k.difficulty,
        cpc: k.cpc,
        estTraffic: estimateTraffic(position, k.volume),
      };
    }),
  };
}

export type GapRow = {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  /** Their strength for this phrase — pages targeting it, or ranking position. */
  theirs: string;
  /** Yours, or null when you don't cover it at all. */
  yours: string | null;
};

export type GapResult = {
  you: OrganicResult;
  them: OrganicResult;
  /** Phrases they cover and you don't. */
  gaps: GapRow[];
  /** Phrases you both cover. */
  shared: GapRow[];
  /** Phrases only you cover. */
  yourEdge: GapRow[];
};

function describe(k: OrganicKeyword): string {
  return k.position === null ? "targeted" : `position ${k.position.toFixed(1)}`;
}

export async function compareDomains(
  yourDomain: string,
  theirDomain: string,
  country: string,
  projectId: string | null,
  projectDomain: string | null,
): Promise<GapResult> {
  const [you, them] = await Promise.all([
    getOrganicKeywords(yourDomain, country, projectId, projectDomain),
    // The competitor side always crawls. Passing the project domain through
    // here meant that entering your own site as the competitor rendered your
    // Search Console figures in the "them" column.
    getOrganicKeywords(theirDomain, country, projectId, projectDomain, false),
  ]);

  const yourMap = new Map(
    you.keywords.map((k) => [k.keyword.toLowerCase(), k]),
  );
  const theirMap = new Map(
    them.keywords.map((k) => [k.keyword.toLowerCase(), k]),
  );

  const gaps: GapRow[] = [];
  const shared: GapRow[] = [];

  for (const k of them.keywords) {
    const mine = yourMap.get(k.keyword.toLowerCase());
    const row: GapRow = {
      keyword: k.keyword,
      volume: k.volume,
      difficulty: k.difficulty,
      cpc: k.cpc,
      theirs: describe(k),
      yours: mine === undefined ? null : describe(mine),
    };
    if (mine === undefined) gaps.push(row);
    else shared.push(row);
  }

  const yourEdge: GapRow[] = you.keywords
    .filter((k) => !theirMap.has(k.keyword.toLowerCase()))
    .map((k) => ({
      keyword: k.keyword,
      volume: k.volume,
      difficulty: k.difficulty,
      cpc: k.cpc,
      theirs: "not covered",
      yours: describe(k),
    }));

  const byValue = (a: GapRow, b: GapRow) => b.volume - a.volume;

  return {
    you,
    them,
    gaps: gaps.sort(byValue),
    shared: shared.sort(byValue),
    yourEdge: yourEdge.sort(byValue).slice(0, 50),
  };
}

/* -------------------------------------------------------------------------- */
/* Explorer dashboard (KeySearch-style overview)                              */
/* -------------------------------------------------------------------------- */

export type CompetitorRow = {
  site: string;
  /** Snaily domain strength 0–10. Null when no signal could be read. */
  ds: number | null;
  /** Domain-level inbound links, derived from Common Crawl PageRank. */
  links: number | null;
  /** Referring domains from Common Crawl PageRank (or a cached graph lookup). */
  domains: number | null;
  /** Real: analysed keywords this domain was seen ranking for. */
  keywords: number;
};

export type ExplorerReport = {
  domain: string;
  /** Domain strength 0–10 (estimated from authority). */
  /** Snaily domain strength 0-10. Null when no signal could be read. */
  domainStrength: number | null;
  /** Average keyword difficulty of organic set. */
  competitionScore: number;
  competitionLabel: string;
  /** Tip target shown beside the score. */
  targetCompetition: number;
  organicCount: number;
  /**
   * Modelled monthly visits across every organic keyword, from position × the
   * CTR curve. Estimated, and labelled as such wherever it is shown.
   */
  estimatedTraffic: number;
  organicPreview: OrganicKeyword[];
  competitors: CompetitorRow[];
  /** Domain-level inbound links from Common Crawl PageRank. */
  backlinks: number | null;
  /**
   * Position in the OpenPageRank webgraph — a real global rank across the
   * crawled web. Null when the domain is not in the graph. Replaces a figure
   * that was previously computed as `11 - domainStrength`, which was not a
   * rank by any definition.
   */
  globalRank: number | null;
  /** Distinct domains citing this one, from live SERP results. Real. */
  citingDomains: number;
  /**
   * Pages read by the crawler, ordered by internal inbound links.
   *
   * The only page list available for a domain we cannot see Search Console
   * for. Carries no traffic figure, because nothing free measures traffic on
   * someone else's site.
   */
  crawledPages: {
    url: string;
    path: string;
    title: string;
    inboundLinks: number;
    words: number;
  }[];
  /**
   * Referring domains: cached Common Crawl graph lookup when present,
   * otherwise inverted from OpenPageRank.
   */
  referringDomains: number | null;
  /** Which Common Crawl release the figure came from. */
  linkDataRelease: string | null;
  /** Strongest linking domains, for the referring-domains table. */
  topLinkingDomains: {
    domain: string;
    hosts: number;
    authority: number | null;
  }[];
  /**
   * Anchor text measured by reading the citing pages themselves.
   *
   * Real words from real pages, not a model — but only across the citing pages
   * Google returned, so it is a sample of the link profile rather than all of
   * it. The UI says so.
   */
  topAnchors: { text: string; count: number }[];
  /** How many citing pages were fetched to produce the two above. */
  citationsRead: number;
  /**
   * Backlink history, one point per day this domain has been analysed.
   *
   * Recorded from the first lookup onward rather than back-filled — no free
   * source publishes a backlink time series, so the curve is built the way a
   * provider builds one: by writing down today's reading and waiting.
   */
  trend: number[];
  /** Dates matching the trend, so the axis is real rather than assumed. */
  trendDates: string[];
  referringPreview: CompetitorRow[];
  rankingDistribution: { band: string; count: number }[];
  /** Whether organic rows came from GSC or crawl. */
  organicSource: "search-console" | "crawl";
  /** Live citing pages when SerpApi is available. */
  citingPages: number;
};

function competitionLabel(score: number): string {
  if (score <= 29) return "Competition easy";
  if (score <= 49) return "Competition easy-moderate";
  if (score <= 69) return "Competition fairly difficult";
  return "Competition difficult";
}

/** Snaily DA (0-100) shown on KeySearch's 0-10 "domain strength" scale. */
function dsFromAuthority(da: number | null): number | null {
  if (da === null) return null;
  return Math.round((Math.min(100, Math.max(0, da)) / 10) * 10) / 10;
}

/**
 * Domains that share SERP real-estate with this site's keywords.
 *
 * Reads `SerpCache` for free — no extra SerpApi spend. Counts how often each
 * other domain appears, then estimates link metrics for the table.
 */
async function competitorsFromSerpCache(
  domain: string,
  keywords: string[],
  country: string,
  limit = 20,
): Promise<CompetitorRow[]> {
  if (keywords.length === 0) return [];

  const rows = await prisma.serpCache.findMany({
    where: {
      engine: "google",
      country,
      query: { in: keywords.map((k) => k.toLowerCase()).slice(0, 40) },
    },
    select: { payload: true },
  });

  const counts = new Map<string, number>();

  for (const row of rows) {
    const organic =
      (row.payload as { organic_results?: { link?: string }[] })
        .organic_results ?? [];
    for (const r of organic) {
      let host = "";
      try {
        host = new URL(r.link ?? "").hostname
          .replace(/^www\./, "")
          .toLowerCase();
      } catch {
        continue;
      }
      if (host === "" || host === domain || host.endsWith(`.${domain}`)) {
        continue;
      }
      // Collapse to registrable-ish host (drop deep subdomains for ranking).
      const parts = host.split(".");
      const site =
        parts.length > 2 && parts[parts.length - 1]!.length <= 3
          ? parts.slice(-3).join(".")
          : parts.slice(-2).join(".");
      counts.set(site, (counts.get(site) ?? 0) + 1);
    }
  }

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

  const sites = top.map(([site]) => site);
  const [authority, linkCounts] = await Promise.all([
    getDomainAuthority(sites),
    // Cache-only: filling this table must never spend the monthly budget.
    getCachedLinkCounts(sites),
  ]);

  return top.map(([site, keywordsHit]) => {
    const scored = authority.get(site);
    const links = scoreLinkCounts({
      openPageRank: scored?.openPageRank ?? null,
      domainAuthority: scored?.score.value ?? null,
      measuredReferringDomains:
        authority.get(site)?.referringDomains ?? linkCounts.get(site) ?? null,
      url: `https://${site}/`,
      pageAuthority: scored?.score.value ?? null,
      position: 1,
    });
    return {
      site,
      ds: dsFromAuthority(scored?.score.value ?? null),
      links: links?.domainBacklinks ?? null,
      domains: links?.domainLinkingDomains ?? null,
      keywords: keywordsHit,
    };
  });
}

/**
 * Full Competitive Analysis Explorer payload for one domain.
 *
 * Aggregates crawl / Search Console organic keywords, citation checks and
 * estimated authority into the KeySearch-shaped dashboard cards.
 */
export async function buildExplorerReport(
  domain: string,
  country: string,
  projectId: string | null,
  projectDomain: string | null,
): Promise<ExplorerReport> {
  const [organic, mentions] = await Promise.all([
    getOrganicKeywords(domain, country, projectId, projectDomain),
    findMentions(domain),
  ]);

  const keywords = organic.keywords;
  const avgDifficulty =
    keywords.length === 0
      ? 40
      : Math.round(
          keywords.reduce((s, k) => s + k.difficulty, 0) / keywords.length,
        );

  const auth = mentions.authority;
  const domainStrength = dsFromAuthority(auth.domainAuthority);

  /*
   * The one place a link lookup is allowed to spend budget: the user has
   * explicitly asked to analyse this domain. Everywhere else reads the cache.
   */
  const linkProfile = await getLinkProfile(domain, { allowFetch: true });
  const scored = (await getDomainAuthority([domain])).get(
    domain.replace(/^www\./, "").toLowerCase(),
  );
  const derivedLinks = scoreLinkCounts({
    openPageRank: scored?.openPageRank ?? null,
    domainAuthority: scored?.score.value ?? null,
    measuredReferringDomains:
      linkProfile?.referringDomains ?? scored?.referringDomains ?? null,
    url: `https://${domain}/`,
    pageAuthority: scored?.score.value ?? null,
    position: 1,
  });

  /*
   * No dofollow / nofollow split. It used to be reported as a flat 73% of the
   * backlink estimate, which was a guess dressed as a measurement: nothing in
   * the PageRank graph records rel attributes, so the number could not have
   * been derived from anything.
   */
  const backlinks = derivedLinks?.domainBacklinks ?? null;

  // openPageRankPos is written by the authority pass but not returned by it,
  // so it is read straight from the cache here.
  const metric = await prisma.domainMetric.findUnique({
    where: { domain: domain.replace(/^www\./, "").toLowerCase() },
    select: { openPageRankPos: true },
  });

  /*
   * Read the pages Google says cite this domain: who links, and with what
   * words. Both panels were previously empty whenever the paid webgraph key
   * was absent, which is always.
   */
  const citingUrls = mentions.mentions.map((m) => m.url);
  const citingHosts = [...new Set(mentions.mentions.map((m) => m.domain))];
  const citingAuthority = await getDomainAuthority(citingHosts).catch(
    () => new Map<string, { score: { value: number | null } }>(),
  );
  const citations = await readCitations(domain, citingUrls, (host) => {
    const value = citingAuthority.get(host)?.score.value;
    return typeof value === "number" ? value : null;
  }).catch(() => ({ domains: [], anchors: [], pagesRead: 0, pagesFound: 0 }));

  const competitors = await competitorsFromSerpCache(
    domain,
    keywords.map((k) => k.keyword),
    country,
    20,
  );

  // Fallback when cache is cold — cite domains from the mention report.
  if (competitors.length === 0 && mentions.mentions.length > 0) {
    const seen = new Set<string>();
    for (const m of mentions.mentions) {
      if (seen.has(m.domain) || m.domain === domain) continue;
      seen.add(m.domain);
      competitors.push({
        site: m.domain,
        ds: null,
        links: null,
        domains: null,
        keywords: 0,
      });
      if (competitors.length >= 12) break;
    }
  }

  /*
   * No backlink history without a link index, and a synthesised curve would be
   * indistinguishable from a real one on a chart — the most misleading kind of
   * fabrication. Empty means the UI renders "not available" instead.
   */
  /*
   * Today's reading is written before it is read back, so the chart always
   * includes the number on the card above it. One row per domain per day:
   * re-analysing does not spike the curve.
   */
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const linkHistory = await recordLinkSnapshot(domain, today, {
    backlinks,
    referringDomains:
      linkProfile?.referringDomains ??
      derivedLinks?.domainLinkingDomains ??
      null,
    authority: auth.domainAuthority,
  });

  const trend = linkHistory.map((h) => h.backlinks ?? 0);
  const trendDates = linkHistory.map((h) => h.day);

  const bands = [
    { band: "1-3", min: 1, max: 3 },
    { band: "4-10", min: 4, max: 10 },
    { band: "11-20", min: 11, max: 20 },
    { band: "21-50", min: 21, max: 50 },
    { band: "51-100", min: 51, max: 100 },
  ] as const;

  const rankingDistribution = bands.map(({ band, min, max }) => ({
    band,
    count: keywords.filter(
      (k) => k.position !== null && k.position >= min && k.position <= max,
    ).length,
  }));

  /*
   * When nothing has a measured position the bands stay at zero and the UI
   * says so. This used to fill them with a fixed 8/18/22/28 split "so the
   * chart isn't empty", which drew a confident-looking distribution out of no
   * measurement at all — the numbers were invented, and a reader had no way to
   * tell. An empty chart that explains itself is the honest version.
   */

  /*
   * Pages the crawler actually saw, for the Top Pages tab on a domain we have
   * no Search Console access to. Ordered by internal inbound links: how the
   * site itself ranks its content, which is real and readable from the crawl.
   */
  const crawledPages = (organic.profile?.pages ?? [])
    .slice()
    .sort((a, b) => b.inboundLinks - a.inboundLinks || b.words - a.words)
    .slice(0, 25)
    .map((p) => ({
      url: p.url,
      path: p.path,
      title: p.title,
      inboundLinks: p.inboundLinks,
      words: p.words,
    }));

  return {
    crawledPages,
    domain,
    domainStrength,
    competitionScore: avgDifficulty,
    competitionLabel: competitionLabel(avgDifficulty),
    targetCompetition: 33,
    organicCount: keywords.length,
    estimatedTraffic: keywords.reduce((n, k) => n + (k.estTraffic ?? 0), 0),
    // Enough to fill the Top Keywords tab, not just the overview card.
    organicPreview: keywords.slice(0, 25),
    competitors,
    backlinks,
    globalRank: metric?.openPageRankPos ?? null,
    citingDomains: mentions.referringDomains,
    referringDomains:
      linkProfile?.referringDomains ??
      derivedLinks?.domainLinkingDomains ??
      null,
    linkDataRelease: linkProfile?.release ?? null,
    /*
     * The webgraph lookup is preferred when a key is configured. Without one,
     * the citing pages we just read are the real answer — measured, if partial,
     * rather than an empty table.
     */
    topLinkingDomains:
      linkProfile?.top && linkProfile.top.length > 0
        ? linkProfile.top
        : citations.domains.map((d) => ({
            domain: d.domain,
            hosts: d.links > 0 ? d.links : d.hosts,
            authority: d.authority,
          })),
    topAnchors: citations.anchors,
    citationsRead: citations.pagesRead,
    trend,
    trendDates,
    referringPreview: competitors.slice(0, 6),
    rankingDistribution,
    organicSource: organic.source,
    citingPages: mentions.mentions.length,
  };
}

/**
 * Writes today's link reading and returns the domain's history.
 *
 * Upserted on (domain, day) so looking at the same site five times in an
 * afternoon leaves one point, not five. Failures are swallowed: a chart is not
 * worth failing a report over.
 */
async function recordLinkSnapshot(
  domain: string,
  day: Date,
  reading: {
    backlinks: number | null;
    referringDomains: number | null;
    authority: number | null;
  },
): Promise<{ day: string; backlinks: number | null }[]> {
  try {
    if (reading.backlinks !== null || reading.referringDomains !== null) {
      await prisma.domainLinkSnapshot.upsert({
        where: { domain_day: { domain, day } },
        create: { domain, day, ...reading },
        update: reading,
      });
    }

    const since = new Date(day);
    since.setUTCFullYear(since.getUTCFullYear() - 1);

    const rows = await prisma.domainLinkSnapshot.findMany({
      where: { domain, day: { gte: since } },
      orderBy: { day: "asc" },
      select: { day: true, backlinks: true },
    });

    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      backlinks: r.backlinks,
    }));
  } catch {
    return [];
  }
}
