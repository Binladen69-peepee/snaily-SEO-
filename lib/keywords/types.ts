/**
 * Provider-agnostic keyword data contract.
 *
 * Every provider (mock today, DataForSEO/Serper/SerpApi later) returns these
 * shapes. Nothing outside `lib/keywords/providers/` may know which provider is
 * in use — swapping providers must only require a new file in that folder.
 */

export const INTENTS = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
] as const;

export type SearchIntent = (typeof INTENTS)[number];

/** How the idea list is generated. Mirrors the mode selector in the search bar. */
export const SEARCH_MODES = [
  "related",
  "broad",
  "exact",
  "questions",
  "long-tail",
  "comparisons",
  "buyer-intent",
] as const;

export type SearchMode = (typeof SEARCH_MODES)[number];

export const SEARCH_MODE_LABEL: Record<SearchMode, string> = {
  related: "Related Keywords",
  broad: "Broad Match",
  exact: "Exact Match",
  questions: "Questions",
  "long-tail": "Long-Tail (4+ words)",
  comparisons: "Comparisons (vs, or, alternative)",
  "buyer-intent": "Buyer Intent (best, top, review)",
};

/** Autocomplete sources merged into the suggestions panel. */
export const SUGGEST_SOURCES = ["google", "bing", "yahoo"] as const;

export type SuggestSource = (typeof SUGGEST_SOURCES)[number];

export const SUGGEST_SOURCE_LABEL: Record<SuggestSource, string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
};

export type Suggestions = Record<SuggestSource, string[]>;

export type Keyword = {
  keyword: string;
  /** Average monthly searches. */
  volume: number;
  /** 0–100. Higher is harder to rank for. */
  difficulty: number;
  /** Cost per click in USD. */
  cpc: number;
  /** Paid competition, 0–1. */
  competition: number;
  /** 12 monthly volumes, oldest first. */
  trend: number[];
  intent: SearchIntent;
  /** Total indexed results for the query. */
  results: number;
  /** live = DataForSEO Keywords Data/Labs; estimated = modelled fallback. */
  metricsSource?: "live" | "estimated";
};

export type SerpResult = {
  position: number;
  title: string;
  url: string;
  domain: string;
  description: string;
  /** Site icon shown next to the result, like Google's own SERP. */
  favicon: string;

  /*
   * Link metrics, all nullable.
   *
   * A SERP response carries no link data. Counts are derived from Common
   * Crawl PageRank (and a cached webgraph lookup when one exists). Null means
   * the domain is not in that graph.
   */
  pageAuthority: number | null;
  domainAuthority: number | null;
  pageLinkingDomains: number | null;
  domainLinkingDomains: number | null;
  authority: number | null;
  backlinks: number | null;
  /** The keyword appears in the URL path. */
  keywordInUrl: boolean;
  wordCount: number;

  /*
   * Signals SerpApi already returns and we used to discard.
   *
   * All of these are REAL — observed in the response for this exact query, at
   * no extra cost, on calls the app has already made. They were being thrown
   * away while fabricated numbers filled the columns beside them.
   */

  /** Publication or freshness date Google displayed, e.g. "4 days ago". */
  publishedDate: string | null;
  /**
   * Sitelinks Google chose to show under this result.
   *
   * A genuine authority signal: Google only expands sitelinks for results it
   * treats as the definitive answer for the query.
   */
  sitelinks: number;
  /** Star rating from the rich snippet, 0–5, when Google shows one. */
  rating: number | null;
  /** Review count behind that rating. */
  reviews: number | null;
  /** Publisher name as Google labels it. */
  sourceName: string;
  /** Breadcrumb-style link Google displays instead of the raw URL. */
  displayedLink: string;
};

export type KeywordDetail = Keyword & {
  related: Keyword[];
  questions: Keyword[];
  serp: SerpResult[];
};

export type KeywordFilters = {
  volumeMin?: number;
  volumeMax?: number;
  difficultyMin?: number;
  difficultyMax?: number;
  cpcMin?: number;
  cpcMax?: number;
  wordsMin?: number;
  wordsMax?: number;
  intent?: SearchIntent;
  /** `+` between terms means AND, `,` means OR — KeySearch's own convention. */
  contains?: string;
  excludes?: string;
};

/**
 * Applies the include/exclude term syntax KeySearch uses:
 * `(+)` joins terms with AND, `(,)` joins them with OR.
 */
export function matchesTerms(keyword: string, expression: string): boolean {
  const haystack = keyword.toLowerCase();
  const orGroups = expression
    .toLowerCase()
    .split(",")
    .map((group) => group.trim())
    .filter((group) => group !== "");

  if (orGroups.length === 0) return true;

  return orGroups.some((group) =>
    group
      .split("+")
      .map((term) => term.trim())
      .filter((term) => term !== "")
      .every((term) => haystack.includes(term)),
  );
}

export type SearchParams = {
  keyword: string;
  country: string;
  language: string;
  mode: SearchMode;
  filters: KeywordFilters;
  page: number;
  perPage: number;
};

export type SearchResult = {
  keyword: string;
  /** Total matching the filters, before pagination. */
  total: number;
  results: Keyword[];
};

export interface KeywordProvider {
  readonly name: string;
  /** True when the provider returns generated data rather than live data. */
  readonly isMock: boolean;
  /**
   * True when SERPs are live but volume/CPC/authority are estimated. SerpApi
   * returns rankings, not keyword metrics, so the UI must say which is which.
   */
  readonly volumeIsEstimated: boolean;
  search(params: SearchParams): Promise<SearchResult>;
  detail(
    keyword: string,
    country: string,
    language: string,
  ): Promise<KeywordDetail>;
  /** Metrics for an explicit list of keywords. Used by bulk analysis. */
  analyze(
    keywords: string[],
    country: string,
    language: string,
  ): Promise<Keyword[]>;
  /** Autocomplete phrases per search engine. Used by the suggestions panel. */
  suggest(keyword: string, country: string): Promise<Suggestions>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * `any` is the worldwide / "All Countries" option — providers default to US
 * when no country-specific endpoint is available.
 *
 * Grouped by region with the most commonly-used markets first.
 */
export const COUNTRIES = [
  // ── North America ──
  { code: "us", label: "United States" },
  { code: "ca", label: "Canada" },
  { code: "mx", label: "Mexico" },

  // ── Europe ──
  { code: "uk", label: "United Kingdom" },
  { code: "de", label: "Germany" },
  { code: "fr", label: "France" },
  { code: "es", label: "Spain" },
  { code: "it", label: "Italy" },
  { code: "nl", label: "Netherlands" },
  { code: "be", label: "Belgium" },
  { code: "at", label: "Austria" },
  { code: "ch", label: "Switzerland" },
  { code: "se", label: "Sweden" },
  { code: "no", label: "Norway" },
  { code: "dk", label: "Denmark" },
  { code: "fi", label: "Finland" },
  { code: "ie", label: "Ireland" },
  { code: "pt", label: "Portugal" },
  { code: "pl", label: "Poland" },
  { code: "cz", label: "Czech Republic" },
  { code: "ro", label: "Romania" },
  { code: "hu", label: "Hungary" },
  { code: "gr", label: "Greece" },
  { code: "bg", label: "Bulgaria" },
  { code: "hr", label: "Croatia" },
  { code: "sk", label: "Slovakia" },
  { code: "ua", label: "Ukraine" },
  { code: "rs", label: "Serbia" },
  { code: "ru", label: "Russia" },
  { code: "tr", label: "Turkey" },

  // ── Asia & Pacific ──
  { code: "in", label: "India" },
  { code: "au", label: "Australia" },
  { code: "nz", label: "New Zealand" },
  { code: "jp", label: "Japan" },
  { code: "kr", label: "South Korea" },
  { code: "cn", label: "China" },
  { code: "hk", label: "Hong Kong" },
  { code: "tw", label: "Taiwan" },
  { code: "sg", label: "Singapore" },
  { code: "my", label: "Malaysia" },
  { code: "id", label: "Indonesia" },
  { code: "th", label: "Thailand" },
  { code: "ph", label: "Philippines" },
  { code: "vn", label: "Vietnam" },
  { code: "pk", label: "Pakistan" },
  { code: "bd", label: "Bangladesh" },

  // ── Middle East ──
  { code: "ae", label: "United Arab Emirates" },
  { code: "sa", label: "Saudi Arabia" },
  { code: "il", label: "Israel" },
  { code: "eg", label: "Egypt" },
  { code: "qa", label: "Qatar" },
  { code: "kw", label: "Kuwait" },
  { code: "bh", label: "Bahrain" },
  { code: "om", label: "Oman" },

  // ── South America ──
  { code: "br", label: "Brazil" },
  { code: "ar", label: "Argentina" },
  { code: "co", label: "Colombia" },
  { code: "cl", label: "Chile" },
  { code: "pe", label: "Peru" },

  // ── Africa ──
  { code: "za", label: "South Africa" },
  { code: "ng", label: "Nigeria" },
  { code: "ke", label: "Kenya" },
  { code: "gh", label: "Ghana" },
] as const;

