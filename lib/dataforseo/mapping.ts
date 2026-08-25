/**
 * Mapping document: Snaily metrics ↔ DataForSEO.
 *
 * Kept as a module so product + engineering share one source of truth.
 * DataForSEO does NOT provide Moz DA/PA — never label its rank as Moz.
 */

export const DATAFORSEO_FIELD_MAP = [
  {
    snailyField: "domainAuthority (SERP DA column)",
    endpoint: "POST /v3/backlinks/bulk_ranks/live",
    dataforseoField: "rank (rank_scale: one_hundred)",
    transformation: "clamp 0–100 integer; null when target unknown",
    provenance: "real · DataForSEO",
    mozEquivalent: false,
    productLabel: "DataForSEO Rank",
  },
  {
    snailyField: "pageAuthority (SERP PA column)",
    endpoint: "POST /v3/backlinks/bulk_ranks/live (page URL targets) — phase 1 still derives from domain rank + SERP position",
    dataforseoField: "rank",
    transformation: "estimated from domain Rank until page-level ranks are wired",
    provenance: "estimated · derived from DataForSEO domain Rank",
    mozEquivalent: false,
    productLabel: "Page strength (estimated)",
  },
  {
    snailyField: "domainLinkingDomains / referringDomains",
    endpoint: "POST /v3/backlinks/summary/live",
    dataforseoField: "referring_domains",
    transformation: "non-negative integer; cached on DomainMetric",
    provenance: "real · DataForSEO",
    mozEquivalent: false,
    productLabel: "Referring domains",
  },
  {
    snailyField: "backlinks (domain-level)",
    endpoint: "POST /v3/backlinks/summary/live",
    dataforseoField: "backlinks",
    transformation: "non-negative integer",
    provenance: "real · DataForSEO",
    mozEquivalent: false,
    productLabel: "Backlinks",
  },
  {
    snailyField: "referring pages",
    endpoint: "POST /v3/backlinks/summary/live",
    dataforseoField: "referring_pages",
    transformation: "non-negative integer",
    provenance: "real · DataForSEO",
    mozEquivalent: false,
    productLabel: "Referring pages",
  },
  {
    snailyField: "provider health",
    endpoint: "GET /v3/appendix/user_data",
    dataforseoField: "status_code / account login",
    transformation: "auth probe only; login redacted to ***@domain",
    provenance: "n/a",
    mozEquivalent: false,
    productLabel: "DataForSEO health",
  },
] as const;

export const AUTHORITY_REPLACEMENT_REPORT = {
  currentSnailyMetric: "Snaily Domain Authority (0–100 composite)",
  currentSource:
    "OpenPageRank (~55%) + SERP visibility (~30%) + RDAP domain age (~15%)",
  dataforseoReplacement: "DataForSEO Rank (0–100) from Backlinks bulk_ranks",
  whyBetter:
    "Provider-backed backlink-index rank with consistent relative ordering across domains, instead of a free-signal composite that can invert strong vs weak domains.",
  equivalentToMoz: false,
  relativeOrderingExpectedToImprove: true,
  caveat:
    "Not Moz DA/PA. Do not claim the PA/DA complaint is fixed until live Keyword Research ordering is compared on real domains.",
} as const;
