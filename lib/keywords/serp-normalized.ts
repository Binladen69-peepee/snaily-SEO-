/**
 * Normalized SERP contract shared by every Snaily feature.
 *
 * Features call getNormalizedSerp() — never SerpApi or DataForSEO directly.
 * Provider details stay in adapters under lib/dataforseo and
 * lib/keywords/providers.
 */

export type SerpProviderId = "dataforseo" | "serpapi";

export type NormalizedOrganicResult = {
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
};

export type NormalizedSerp = {
  keyword: string;
  location: string;
  language: string;
  depth: number;
  device: "desktop" | "mobile";
  organicResults: NormalizedOrganicResult[];
  paa: string[];
  relatedSearches: string[];
  serpFeatures: string[];
  totalResults: number | null;
  provider: SerpProviderId;
  retrievedAt: string;
  /** True when served from SerpCache without a live provider call. */
  fromCache: boolean;
  estimatedCost: number;
};

export type GetNormalizedSerpParams = {
  keyword: string;
  country: string;
  language?: string;
  /** How many organic results the feature needs (default 10, max 100). */
  depth?: number;
  device?: "desktop" | "mobile";
  /** When true, never call SerpApi even if DataForSEO fails. */
  skipSerpApi?: boolean;
  /**
   * DataForSEO is the primary provider and the default. Pass "serpapi" only to
   * deliberately put SerpApi first — nothing in the product does today.
   */
  preferProvider?: "dataforseo" | "serpapi";
  /**
   * Optional city/region for localised SERPs. DataForSEO accepts
   * `location_name` (e.g. "London,England,United Kingdom"). When set, the
   * SERP reflects local results for that geography.
   */
  location?: string;
};
