import { prisma } from "@/lib/db";

/**
 * Referring-domain data from the Common Crawl domain webgraph, via CrawlGraph.
 *
 * This is the one free source of real inbound-link data I could find that is
 * both documented and actually up. Two others were evaluated and rejected:
 * SerpApi returns no link data of any kind, and the CC Backlink Checker's
 * public API sits on a Hugging Face Space that was paused when tested.
 *
 * The constraint that shapes everything here: the free tier is **15 calls a
 * month**. A ten-row SERP would spend two thirds of that on a single search, so
 * lookups are never automatic. They happen only when someone explicitly
 * analyses a domain, results are cached for a month, and the SERP table reads
 * that cache rather than filling it.
 *
 * What this gives us, honestly:
 *   REAL         referring domain count, and which domains link in
 *   REAL         per-linking-domain authority from the same graph
 *   UNAVAILABLE  total backlinks, dofollow/nofollow split, anchor text
 *
 * Common Crawl is a sample of the web, not all of it, and it is rebuilt
 * quarterly. Counts will read lower than Ahrefs and will not move day to day.
 */

/** Free tier. Exceeding it returns errors, so we stop before that. */
const MONTHLY_CALL_BUDGET = 15;

/** Matches the DomainMetric cache window and the graph's rebuild cadence. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function crawlGraphConfigured(): boolean {
  return (process.env.CRAWLGRAPH_API_KEY ?? "").trim() !== "";
}

export type LinkingDomain = {
  domain: string;
  /** Distinct hosts on that domain linking in. */
  hosts: number;
  /** CrawlGraph authority 0–100 for the linking domain. */
  authority: number | null;
};

export type LinkProfile = {
  domain: string;
  /** Distinct domains linking in, per the Common Crawl graph. */
  referringDomains: number;
  /** The strongest linking domains, for the referring-domains table. */
  top: LinkingDomain[];
  /** Which quarterly crawl the figures came from. */
  release: string;
  fetchedAt: string;
};

/** Calls already spent this calendar month, counted from what we cached. */
export async function callsUsedThisMonth(): Promise<number> {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  return prisma.domainMetric.count({
    where: { linkDataFetchedAt: { gte: since } },
  });
}

export type LinkBudget = { used: number; limit: number; remaining: number };

export async function linkBudget(): Promise<LinkBudget> {
  const used = await callsUsedThisMonth();
  return {
    used,
    limit: MONTHLY_CALL_BUDGET,
    remaining: Math.max(0, MONTHLY_CALL_BUDGET - used),
  };
}

type CrawlGraphResponse = {
  domain?: string;
  release_label?: string;
  release_id?: string;
  total_linking_domains?: number;
  results?: {
    linking_domain?: string;
    num_hosts?: number;
    cg_authority?: number;
  }[];
};

function toInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * The link profile for one domain.
 *
 * Reads the cache first and only spends a call when the cached copy is missing
 * or a month old. Returns null — never a guess — when there is no key, no
 * budget left, or the upstream call fails.
 */
export async function getLinkProfile(
  input: string,
  options: { allowFetch?: boolean } = {},
): Promise<LinkProfile | null> {
  const domain = input.replace(/^www\./, "").toLowerCase().trim();
  if (domain === "") return null;

  const cached = await prisma.domainMetric.findUnique({ where: { domain } });

  if (
    cached?.linkDataFetchedAt != null &&
    Date.now() - cached.linkDataFetchedAt.getTime() < TTL_MS &&
    cached.referringDomains !== null
  ) {
    return {
      domain,
      referringDomains: cached.referringDomains,
      top: (cached.linkingDomains as LinkingDomain[] | null) ?? [],
      release: cached.linkDataRelease,
      fetchedAt: cached.linkDataFetchedAt.toISOString(),
    };
  }

  // Cache miss. Everything below spends budget, so it is opt-in only: the SERP
  // table passes allowFetch=false and simply shows what is already known.
  if (options.allowFetch !== true) return null;

  const key = (process.env.CRAWLGRAPH_API_KEY ?? "").trim();
  if (key === "") return null;

  const { remaining } = await linkBudget();
  if (remaining <= 0) return null;

  let payload: CrawlGraphResponse;
  try {
    const res = await fetch("https://crawlgraph.com/api/v1/backlinks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // 50 is plenty for a "top referring domains" table and keeps the
      // response small; the count itself is returned separately.
      body: JSON.stringify({ domain, limit: 50, sort: "authority" }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    payload = (await res.json()) as CrawlGraphResponse;
  } catch {
    return null;
  }

  const referringDomains = toInt(payload.total_linking_domains);
  if (referringDomains === null) return null;

  const top: LinkingDomain[] = (payload.results ?? [])
    .map((r) => ({
      domain: (r.linking_domain ?? "").toLowerCase(),
      hosts: toInt(r.num_hosts) ?? 0,
      authority: toInt(r.cg_authority),
    }))
    .filter((r) => r.domain !== "")
    .slice(0, 25);

  const release = payload.release_label ?? payload.release_id ?? "Common Crawl";
  const now = new Date();

  const data = {
    referringDomains,
    linkingDomains: top,
    linkDataRelease: release,
    linkDataFetchedAt: now,
  };

  await prisma.domainMetric.upsert({
    where: { domain },
    create: { domain, ...data },
    update: data,
  });

  return {
    domain,
    referringDomains,
    top,
    release,
    fetchedAt: now.toISOString(),
  };
}

/** Cached-only lookup for many domains — used by SERP and competitor tables. */
export async function getCachedLinkCounts(
  domains: string[],
): Promise<Map<string, number>> {
  const normalised = [...new Set(
    domains.map((d) => d.replace(/^www\./, "").toLowerCase()).filter((d) => d !== ""),
  )];
  const out = new Map<string, number>();
  if (normalised.length === 0) return out;

  const rows = await prisma.domainMetric.findMany({
    where: { domain: { in: normalised }, referringDomains: { not: null } },
    select: { domain: true, referringDomains: true },
  });

  for (const row of rows) {
    if (row.referringDomains !== null) out.set(row.domain, row.referringDomains);
  }
  return out;
}
