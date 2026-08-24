import { ctrForPosition } from "@/lib/keywords/ctr";
import { prisma } from "@/lib/db";

/**
 * How often a domain shows up in the SERPs we have already fetched.
 *
 * This is the one authority signal that is entirely ours and costs nothing:
 * every SerpApi call the app has ever made is retained in `SerpCache`, so the
 * corpus grows on its own as the tool is used. Google putting a domain on page
 * one, repeatedly, across unrelated queries, is a direct statement about how
 * much Google trusts it — arguably a better signal than a link count.
 *
 * It is genuinely observed data, not modelling. The caveat is coverage: it can
 * only speak about domains that have appeared in searches this deployment has
 * run, so a domain with no appearances scores zero for *lack of evidence*, not
 * for lack of authority. Callers must weight it accordingly.
 */

export type DomainVisibility = {
  /** Distinct cached SERPs the domain appears in. */
  appearances: number;
  /** Sum of CTR share across every appearance — traffic-weighted presence. */
  weightedShare: number;
  /** Mean organic position across appearances. */
  averagePosition: number;
  /** Distinct queries it ranked for. */
  queries: number;
  /**
   * SERPs where Google expanded sitelinks under this domain's result.
   *
   * Google only does this when it treats the result as the definitive answer,
   * so it is a direct, observed statement of trust — and it costs nothing,
   * because it is already sitting in every cached payload.
   */
  sitelinkHits: number;
};

type CachedSerp = {
  organic_results?: {
    position?: number;
    link?: string;
    sitelinks?: { inline?: unknown[]; expanded?: unknown[]; list?: unknown[] };
  }[];
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Builds the visibility table across the whole SERP cache.
 *
 * Done in one pass for every domain rather than per-domain lookups: the cache
 * is a few hundred rows of JSON, and scanning it once is far cheaper than
 * scanning it once per domain on a ten-row SERP.
 */
export async function buildVisibilityIndex(): Promise<Map<string, DomainVisibility>> {
  const rows = await prisma.serpCache.findMany({
    where: { engine: "google" },
    select: { query: true, payload: true },
  });

  const acc = new Map<
    string,
    {
      appearances: number;
      weightedShare: number;
      positionSum: number;
      queries: Set<string>;
      sitelinkHits: number;
    }
  >();

  for (const row of rows) {
    const payload = row.payload as CachedSerp | null;
    const organic = payload?.organic_results ?? [];

    // One entry per domain per SERP: a site holding two slots for the same
    // query should not count as two independent votes of confidence.
    const seenHere = new Set<string>();

    for (const [index, result] of organic.entries()) {
      const host = hostOf(result.link ?? "");
      if (host === "" || seenHere.has(host)) continue;
      seenHere.add(host);

      const position = result.position ?? index + 1;
      const entry = acc.get(host) ?? {
        appearances: 0,
        weightedShare: 0,
        positionSum: 0,
        queries: new Set<string>(),
        sitelinkHits: 0,
      };

      const sitelinks =
        (result.sitelinks?.inline?.length ?? 0) +
        (result.sitelinks?.expanded?.length ?? 0) +
        (result.sitelinks?.list?.length ?? 0);
      if (sitelinks > 0) entry.sitelinkHits += 1;

      entry.appearances += 1;
      entry.weightedShare += ctrForPosition(position);
      entry.positionSum += position;
      entry.queries.add(row.query);
      acc.set(host, entry);
    }
  }

  const out = new Map<string, DomainVisibility>();
  for (const [host, e] of acc) {
    out.set(host, {
      appearances: e.appearances,
      weightedShare: Math.round(e.weightedShare * 100) / 100,
      averagePosition: Math.round((e.positionSum / e.appearances) * 10) / 10,
      queries: e.queries.size,
      sitelinkHits: e.sitelinkHits,
    });
  }

  return out;
}

/** How many SERPs the corpus holds — the denominator for any share figure. */
export async function corpusSize(): Promise<number> {
  return prisma.serpCache.count({ where: { engine: "google" } });
}
