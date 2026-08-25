import type { SerpResult } from "@/lib/keywords/types";

/**
 * First-page competitive analysis.
 *
 * Same discipline as the other scores in this app: every number is a plain
 * aggregate of the ten results on screen, so a user can check the maths by
 * reading the table above it. No hidden model.
 */

/** The six metrics summarised under the SERP table. */
export type SerpMetricKey =
  | "pageAuthority"
  | "domainAuthority"
  | "pageLinkingDomains"
  | "domainLinkingDomains"
  | "authority"
  | "backlinks";

export const SERP_METRIC_LABEL: Record<SerpMetricKey, string> = {
  pageAuthority: "PA",
  /** Short label kept for layout; tooltip clarifies DataForSEO Rank vs Snaily. */
  domainAuthority: "DA",
  pageLinkingDomains: "Doms",
  domainLinkingDomains: "DomsD",
  authority: "Auth",
  backlinks: "Links",
};

export const SERP_METRIC_TITLE: Record<SerpMetricKey, string> = {
  pageAuthority:
    "Page strength — estimated from domain Rank/Authority and SERP position. Not Moz PA.",
  domainAuthority:
    "Domain strength — DataForSEO Rank when connected, otherwise Snaily Domain Authority. Authority metric supplied by DataForSEO is not Moz DA unless explicitly sourced from Moz.",
  pageLinkingDomains:
    "Domains linking to the ranking page (measured when DataForSEO/CrawlGraph supplies them; otherwise modelled from PageRank)",
  domainLinkingDomains:
    "Domains linking to the whole site (DataForSEO referring_domains when fetched; otherwise Common Crawl / modelled)",
  authority: "Trust signal for the site",
  backlinks:
    "Inbound links to the ranking page (DataForSEO when fetched; otherwise modelled from PageRank)",
};

export const SERP_METRIC_KEYS: SerpMetricKey[] = [
  "pageAuthority",
  "domainAuthority",
  "pageLinkingDomains",
  "domainLinkingDomains",
  "authority",
  "backlinks",
];

export type SerpStats = {
  /** Null for any metric no configured provider supplies. */
  lowest: Record<SerpMetricKey, number | null>;
  average: Record<SerpMetricKey, number | null>;
  /**
   * 0–100. Higher means the first page is harder to break into.
   *
   * Null when there is no link data behind it. A score derived from nothing is
   * worse than no score: it reads as a measurement.
   */
  linksScore: number | null;
  /**
   * Linking domains you'd realistically need. Based on the top 5 rather than
   * all 10 — matching the weakest result is rarely enough to hold a position.
   */
  domainsToRank: number | null;
  /** Plain-language reasons behind linksScore. Empty when it cannot be computed. */
  reasons: { label: string; detail: string }[];
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

export function serpStats(results: SerpResult[]): SerpStats | null {
  if (results.length === 0) return null;

  const lowest = {} as Record<SerpMetricKey, number | null>;
  const average = {} as Record<SerpMetricKey, number | null>;

  // Null means "no provider supplies this metric" — summing it as zero would
  // manufacture a figure, so unavailable columns stay unavailable.
  for (const key of SERP_METRIC_KEYS) {
    const values = results
      .map((r) => r[key])
      .filter((v): v is number => v !== null);
    lowest[key] = values.length === 0 ? null : Math.min(...values);
    average[key] = values.length === 0 ? null : mean(values);
  }

  const topFiveDomains = results
    .slice(0, 5)
    .map((r) => r.pageLinkingDomains)
    .filter((v): v is number => v !== null);

  const domainsToRank = topFiveDomains.length === 0 ? null : mean(topFiveDomains);
  const avgAuthority = average.pageAuthority;

  // With no authority and no link counts there is nothing to score. Returning
  // a floor of 1 here is what produced "Links Score 1 — you may need 0 linking
  // domains", a confident-looking number standing on no data at all.
  if (avgAuthority === null && domainsToRank === null) {
    return { lowest, average, linksScore: null, domainsToRank: null, reasons: [] };
  }

  // Two halves, each 0–50: how authoritative the page is, and how many links
  // sit behind it. Links are log-scaled — 10 vs 100 domains matters far more
  // than 5,000 vs 5,100.
  const authorityPart =
    avgAuthority === null ? 0 : Math.min(50, (avgAuthority / 100) * 50);
  const linkPart =
    domainsToRank === null
      ? 0
      : Math.min(50, (Math.log10(Math.max(domainsToRank, 1)) / 4) * 50);

  const linksScore = Math.max(
    1,
    Math.min(100, Math.round(authorityPart + linkPart)),
  );

  const reasons: { label: string; detail: string }[] = [];
  if (avgAuthority !== null) {
    reasons.push({
      label: `Average page authority ${String(avgAuthority)}`,
      detail: `contributes ${String(Math.round(authorityPart))} points`,
    });
  }
  if (domainsToRank !== null) {
    reasons.push({
      label: `Top 5 average ${String(domainsToRank)} linking domains`,
      detail: `contributes ${String(Math.round(linkPart))} points`,
    });
  }
  if (lowest.pageAuthority !== null) {
    reasons.push({
      label: `Weakest result on page 1 has PA ${String(lowest.pageAuthority)}`,
      detail: "the realistic floor to beat",
    });
  }

  return { lowest, average, linksScore, domainsToRank, reasons };
}

/** Same 5 bands as keyword difficulty, so colour means one thing app-wide. */
export function linksBand(score: number): { label: string; className: string } {
  if (score <= 20) return { label: "Very Easy", className: "text-kd-1" };
  if (score <= 40) return { label: "Easy", className: "text-kd-3" };
  if (score <= 60) return { label: "Moderate", className: "text-kd-4" };
  if (score <= 80) return { label: "Hard", className: "text-kd-6" };
  return { label: "Very Hard", className: "text-kd-7" };
}

/**
 * How beatable one competitor looks on one metric, as a cell tint.
 *
 * Green means weak enough to outrank, red means entrenched. Thresholds are per
 * metric because the scales are wildly different — a page authority of 60 is
 * strong, whereas 60 backlinks is nothing.
 */
const CELL_THRESHOLDS: Record<SerpMetricKey, [number, number]> = {
  pageAuthority: [35, 50],
  domainAuthority: [40, 60],
  pageLinkingDomains: [50, 500],
  domainLinkingDomains: [5_000, 100_000],
  authority: [500, 5_000],
  backlinks: [1_000, 20_000],
};

export function cellTint(key: SerpMetricKey, value: number): string {
  const [easy, hard] = CELL_THRESHOLDS[key];
  if (value <= easy) return "bg-cell-good";
  if (value >= hard) return "bg-cell-bad";
  return "bg-cell-mid";
}
