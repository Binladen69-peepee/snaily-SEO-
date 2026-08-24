/**
 * Snaily link counts — Doms, DomsD and Links.
 *
 * READ THIS BEFORE TRUSTING A NUMBER FROM HERE.
 *
 * Only one path in this file produces a measured quantity: when
 * `measuredReferringDomains` is supplied, it comes from a real Common Crawl
 * webgraph lookup and is used as-is. That value is REAL.
 *
 * Every other number here is a MODELLED ESTIMATE, and the modelling rests on
 * an approximation that has to be stated honestly rather than buried:
 *
 *   PageRank does not invert to a link count. It measures the authority of
 *   the pages linking in, not how many there are. A domain with ten strong
 *   inlinks and one with ten thousand weak ones can score identically, so
 *   `10^(opr * 0.75)` cannot recover the true referring-domain count for any
 *   individual domain.
 *
 * What the curve *does* do usefully is preserve ordering: a domain with a
 * higher PageRank almost always has more referring domains than one with a
 * lower PageRank, so sorting a SERP by these figures gives roughly the right
 * ranking. The absolute values are indicative magnitude only, and the
 * constants below are calibrated to land in familiar bands — they are not
 * measurements of anything.
 *
 * The fallback via `pageRankFromAuthority` is weaker still: Snaily DA is built
 * partly from domain age and SERP presence, so a count derived from it is
 * several steps removed from any link data at all.
 *
 * Consequence for the UI: these must be rendered as estimates, never beside a
 * measured figure without a marker. `LINK_COUNT_PROVENANCE` carries that.
 */

import type { Provenance } from "@/lib/metrics/provenance";

export const LINK_COUNT_NOTE =
  "Estimated from Common Crawl PageRank, not a live backlink crawl. PageRank measures the strength of inbound links rather than their number, so treat these as indicative magnitude and relative ordering — not as counts. A measured figure replaces the estimate wherever a webgraph lookup exists.";

export const LINK_COUNT_MEASURED_NOTE =
  "Measured: distinct linking domains from the Common Crawl webgraph.";

/** Which of the two paths produced a given result. */
export const LINK_COUNT_PROVENANCE: Record<"measured" | "modelled", Provenance> = {
  measured: "real",
  modelled: "estimated",
};

/** Exponent that maps OPR 0–10 onto referring-domain magnitude. */
const OPR_TO_RD_EXPONENT = 0.75;

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Distinct domains linking to a site, from its Common Crawl PageRank.
 *
 * Power-law inversion of a 0–10 log rank. Calibrated so typical values land
 * in the same bands paid tools report:
 *   OPR 2  → tens of linking domains
 *   OPR 4  → ~1,000
 *   OPR 6.5 → ~80,000
 *   OPR 8.5 → ~2.5 million
 */
export function referringDomainsFromRank(openPageRank: number): number {
  const opr = Math.max(0, Math.min(10, openPageRank));
  if (opr <= 0) return 0;
  return clampInt(Math.pow(10, opr * OPR_TO_RD_EXPONENT) - 1, 0, 50_000_000);
}

/**
 * Total inbound links to a site.
 *
 * Referring domains are unique hosts; raw backlinks are several links per
 * host. The multiplier grows with rank — large sites attract more pages per
 * linking domain than small ones.
 */
export function domainBacklinksFromRank(
  referringDomains: number,
  openPageRank: number,
): number {
  const opr = Math.max(0, Math.min(10, openPageRank));
  const perDomain = 2.4 + opr * 1.15;
  return clampInt(referringDomains * perDomain, 0, 500_000_000);
}

function pathDepth(url: string): number {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    if (path === "" || path === "/") return 0;
    return path.split("/").filter(Boolean).length;
  } catch {
    return 2;
  }
}

function isHome(url: string): boolean {
  return pathDepth(url) === 0;
}

/**
 * Share of the domain's linking domains that typically reach this URL.
 *
 * Homepages collect most of a site's links. A ranking article still earns a
 * slice — more if it is shallow or has high page authority.
 */
export function pageLinkShare(input: {
  url: string;
  pageAuthority: number | null;
  position: number | null;
}): number {
  if (isHome(input.url)) {
    return 0.52;
  }

  const pa = Math.max(0, Math.min(100, input.pageAuthority ?? 30)) / 100;
  const depth = pathDepth(input.url);
  const depthPenalty = Math.min(0.012, Math.max(0, depth - 1) * 0.003);
  const positionLift =
    input.position != null && input.position > 0
      ? Math.max(0, (11 - input.position) * 0.0015)
      : 0;

  return Math.max(0.003, Math.min(0.22, 0.006 + pa * 0.028 + positionLift - depthPenalty));
}

export type LinkCounts = {
  /** Doms — distinct domains linking to this URL. */
  pageLinkingDomains: number;
  /** DomsD — distinct domains linking to the whole site. */
  domainLinkingDomains: number;
  /** Links — inbound links to this URL. */
  backlinks: number;
  /** Inbound links to the whole site. */
  domainBacklinks: number;
  /**
   * "real" only when a Common Crawl webgraph lookup supplied the domain count.
   * Otherwise "estimated" — the figures came from the PageRank curve, which
   * cannot measure link counts. The UI must not render these identically.
   */
  provenance: Provenance;
  note: string;
};

/**
 * Map a 0–100 authority score onto the same 0–10 scale OpenPageRank uses,
 * so link counts can be produced when the PageRank API is not configured.
 */
export function pageRankFromAuthority(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.max(0, Math.min(10, score / 10));
}

export function scoreLinkCounts(input: {
  openPageRank: number | null;
  /** Snaily DA 0–100 — used when OpenPageRank was not available. */
  domainAuthority?: number | null;
  /** Measured Common Crawl referring domains, when a graph lookup exists. */
  measuredReferringDomains?: number | null;
  url: string;
  pageAuthority: number | null;
  position?: number | null;
}): LinkCounts | null {
  const measured =
    typeof input.measuredReferringDomains === "number" &&
    Number.isFinite(input.measuredReferringDomains)
      ? Math.max(0, Math.round(input.measuredReferringDomains))
      : null;

  const opr =
    input.openPageRank != null && Number.isFinite(input.openPageRank)
      ? input.openPageRank
      : null;
  const fromAuthority =
    input.domainAuthority != null && Number.isFinite(input.domainAuthority)
      ? pageRankFromAuthority(input.domainAuthority)
      : input.pageAuthority != null && Number.isFinite(input.pageAuthority)
        ? pageRankFromAuthority(input.pageAuthority)
        : null;

  if (measured === null && opr === null && fromAuthority === null) {
    return null;
  }

  const rank = (opr != null && opr > 0 ? opr : null) ?? fromAuthority ?? 0;
  const domainLinkingDomains =
    measured ?? referringDomainsFromRank(rank);
  const domainBacklinks = domainBacklinksFromRank(
    domainLinkingDomains,
    rank > 0 ? rank : Math.min(10, Math.log10(1 + domainLinkingDomains) / OPR_TO_RD_EXPONENT),
  );

  const share = pageLinkShare({
    url: input.url,
    pageAuthority: input.pageAuthority,
    position: input.position ?? null,
  });

  const pageLinkingDomains = clampInt(
    domainLinkingDomains * share,
    domainLinkingDomains === 0 ? 0 : 1,
    domainLinkingDomains,
  );
  const pagePerDomain = Math.max(
    1.15,
    domainLinkingDomains === 0 ? 1.15 : domainBacklinks / domainLinkingDomains,
  );
  const backlinks = clampInt(
    pageLinkingDomains * pagePerDomain,
    pageLinkingDomains,
    domainBacklinks,
  );

  return {
    pageLinkingDomains,
    domainLinkingDomains,
    backlinks,
    domainBacklinks,
    // Page-level figures are always modelled — the measured lookup is
    // domain-level only, so a URL's own share of it is still a projection.
    provenance: measured === null ? "estimated" : "real",
    note: measured === null ? LINK_COUNT_NOTE : LINK_COUNT_MEASURED_NOTE,
  };
}
