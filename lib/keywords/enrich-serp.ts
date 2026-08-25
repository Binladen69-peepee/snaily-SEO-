/**
 * Attach Snaily authority / link metrics to organic SERP rows.
 *
 * Shared by the live KeywordProvider regardless of which SERP vendor supplied
 * the URLs — authority still comes from DataForSEO Rank / Snaily composite.
 */

import { ctrForPosition } from "@/lib/keywords/ctr";
import type { SerpResult } from "@/lib/keywords/types";
import { getDomainAuthority, scoreDomain } from "@/lib/metrics/authority";
import { getCachedLinkCounts } from "@/lib/metrics/link-data";
import { scoreLinkCounts } from "@/lib/metrics/link-counts";
import { scorePage } from "@/lib/metrics/page-authority";
import { wellKnownPageRank } from "@/lib/metrics/sources";

export async function enrichSerpWithAuthority(
  results: SerpResult[],
): Promise<SerpResult[]> {
  if (results.length === 0) return results;

  const domains = results.map((r) => r.domain);
  const [authority, cachedLinks] = await Promise.all([
    getDomainAuthority(domains).catch(() => new Map()),
    getCachedLinkCounts(domains).catch(() => new Map()),
  ]);

  return results.map((r) => {
    const host = r.domain.replace(/^www\./, "").toLowerCase();
    let domain = authority.get(host);

    if (domain == null || domain.score.value === null) {
      domain = scoreDomain(
        host,
        {
          openPageRank: domain?.openPageRank ?? wellKnownPageRank(host),
          domainAgeYears: null,
          visibility: {
            appearances: 1,
            weightedShare: ctrForPosition(r.position),
            averagePosition: r.position,
            queries: 1,
            sitelinkHits: r.sitelinks > 0 ? 1 : 0,
          },
        },
        1,
      );
    }

    const page = scorePage({
      url: r.url,
      domain,
      serpPosition: r.position,
    });
    const links = scoreLinkCounts({
      openPageRank: domain.openPageRank,
      domainAuthority: domain.score.value,
      measuredReferringDomains:
        domain.referringDomains ?? cachedLinks.get(host) ?? null,
      url: r.url,
      pageAuthority: page.value,
      position: r.position,
    });

    return {
      ...r,
      domainAuthority: domain.score.value,
      pageAuthority: page.value,
      authority: domain.trust.value,
      pageLinkingDomains: links?.pageLinkingDomains ?? null,
      domainLinkingDomains: links?.domainLinkingDomains ?? null,
      backlinks: links?.backlinks ?? null,
    };
  });
}

export function faviconFor(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function normalizedToSerpResults(
  keyword: string,
  organic: Array<{
    position: number;
    title: string;
    url: string;
    domain: string;
    snippet: string;
    displayedLink: string;
    sourceName: string;
    favicon: string;
    publishedDate: string | null;
    sitelinks: number;
    rating: number | null;
    reviews: number | null;
  }>,
): SerpResult[] {
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);

  return organic.map((r) => {
    let path = "";
    try {
      path = new URL(r.url).pathname.toLowerCase();
    } catch {
      path = r.url.toLowerCase();
    }

    return {
      position: r.position,
      title: r.title,
      url: r.url,
      domain: r.domain,
      description: r.snippet,
      favicon: r.favicon || faviconFor(r.domain),
      publishedDate: r.publishedDate,
      sitelinks: r.sitelinks,
      rating: r.rating,
      reviews: r.reviews,
      sourceName: r.sourceName || r.domain,
      displayedLink: r.displayedLink,
      keywordInUrl: words.length > 0 && words.every((w) => path.includes(w)),
      wordCount: 0,
      pageAuthority: null,
      domainAuthority: null,
      pageLinkingDomains: null,
      domainLinkingDomains: null,
      authority: null,
      backlinks: null,
    };
  });
}
