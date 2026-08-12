import { prisma } from "@/lib/db";
import { difficultyFromSerpComposition } from "@/lib/keywords/authority";
import { estimateKeyword } from "@/lib/keywords/estimate";
import {
  matchesTerms,
  ProviderError,
  SUGGEST_SOURCES,
  type Keyword,
  type KeywordDetail,
  type KeywordProvider,
  type SearchParams,
  type SearchResult,
  type SerpResult,
  type Suggestions,
} from "@/lib/keywords/types";

/**
 * SerpApi provider — real Google results.
 *
 * What is genuinely live here: the ranking URLs, titles, snippets, favicons,
 * positions, total result count, related searches and autocomplete.
 *
 * What is NOT live: search volume and CPC — estimated, and badged as such.
 *
 * What is simply unavailable: PA, DA, referring domains and backlink counts.
 * Those come from a crawled backlink index that this deployment does not have,
 * so they are reported as null and rendered as "N/A". They are never invented.
 */

const ENDPOINT = "https://serpapi.com/search.json";

/** Cached responses are reused for a week — SERPs barely move day to day. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type OrganicResult = {
  position?: number;
  title?: string;
  link?: string;
  displayed_link?: string;
  snippet?: string;
  favicon?: string;
  source?: string;
};

type SerpApiResponse = {
  error?: string;
  search_information?: { total_results?: number };
  organic_results?: OrganicResult[];
  related_searches?: { query?: string }[];
  related_questions?: { question?: string }[];
  suggestions?: { value?: string }[];
};

/**
 * One cached round-trip to SerpApi.
 *
 * Every SerpApi call in the app goes through here so the monthly quota is only
 * ever spent on genuinely new queries — responses are reused for a week, and a
 * stale response is preferred over a failed page when SerpApi is down.
 *
 * `T` is the caller's expected response shape; each engine returns different
 * top-level keys (organic_results, video_results, …).
 */
export async function serpFetch<T extends { error?: string }>(
  apiKey: string,
  engine: string,
  query: string,
  country: string,
  extra: Record<string, string> = {},
): Promise<T> {
  // The cache key must include anything that changes the response, or two
  // different requests would collide on one row.
  const variant = Object.entries(extra)
    .filter(([k]) => k !== "api_key")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const key = {
    engine,
    query: variant === "" ? query.toLowerCase() : `${query.toLowerCase()}?${variant}`,
    country,
  };

  const cached = await prisma.serpCache.findUnique({
    where: { engine_query_country: key },
  });

  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return cached.payload as T;
  }

  const search: Record<string, string> = {
    engine,
    api_key: apiKey,
    hl: "en",
    num: "10",
    ...extra,
  };

  search.q = query;

  // "any" is the worldwide option in the location selector. Google geolocates
  // when no `gl` is given, so the parameter is omitted rather than faked.
  if (country !== "any") search.gl = country;

  const params = new URLSearchParams(search);

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Serve stale data rather than failing the page when SerpApi is slow.
    if (cached) return cached.payload as T;
    throw new ProviderError(
      "Could not reach the SERP data source. Please try again.",
      "serpapi",
    );
  }

  if (!res.ok) {
    if (cached) return cached.payload as T;
    if (res.status === 401) {
      throw new ProviderError("The SerpApi key was rejected.", "serpapi");
    }
    if (res.status === 429) {
      throw new ProviderError(
        "The SerpApi monthly search quota is used up.",
        "serpapi",
      );
    }
    throw new ProviderError(
      `The SERP data source returned ${String(res.status)}.`,
      "serpapi",
    );
  }

  const payload = (await res.json()) as T;

  if (payload.error !== undefined) {
    if (cached) return cached.payload as T;
    throw new ProviderError(payload.error, "serpapi");
  }

  await prisma.serpCache.upsert({
    where: { engine_query_country: key },
    create: { ...key, payload: payload as object },
    update: { payload: payload as object, fetchedAt: new Date() },
  });

  return payload;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Google's public favicon service — no extra API call, no key, cached by them. */
function faviconFor(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export class SerpApiProvider implements KeywordProvider {
  readonly name = "serpapi";
  readonly isMock = false;
  /** Live SERPs, estimated volume — the UI uses this to badge the difference. */
  readonly volumeIsEstimated = true;

  constructor(private readonly apiKey: string) {}

  private fetchCached(
    engine: string,
    query: string,
    country: string,
    extra: Record<string, string> = {},
  ): Promise<SerpApiResponse> {
    return serpFetch<SerpApiResponse>(
      this.apiKey,
      engine,
      query,
      country,
      extra,
    );
  }

  private toSerpResults(
    data: SerpApiResponse,
    keyword: string,
  ): SerpResult[] {
    const organic = data.organic_results ?? [];
    const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);

    return organic.slice(0, 10).map((r, i) => {
      const url = r.link ?? "";
      const domain = hostOf(url) || (r.source ?? "");
      const position = r.position ?? i + 1;

      // This one IS real: check the actual URL path for the keyword's words.
      let path = "";
      try {
        path = new URL(url).pathname.toLowerCase();
      } catch {
        path = url.toLowerCase();
      }

      return {
        position,
        title: r.title ?? url,
        url,
        domain,
        description: r.snippet ?? "",
        favicon: r.favicon ?? faviconFor(domain),
        keywordInUrl: words.length > 0 && words.every((w) => path.includes(w)),
        wordCount: 0,
        // A SERP response carries no link data. Reporting null keeps the UI
        // honest instead of inventing a number that looks authoritative.
        pageAuthority: null,
        domainAuthority: null,
        pageLinkingDomains: null,
        domainLinkingDomains: null,
        authority: null,
        backlinks: null,
      };
    });
  }

  async detail(
    keyword: string,
    country: string,
    language: string,
  ): Promise<KeywordDetail> {
    void language;
    const data = await this.fetchCached("google", keyword, country);
    const serp = this.toSerpResults(data, keyword);

    const base = estimateKeyword(
      keyword,
      country,
      data.search_information?.total_results,
    );

    // Difficulty is scored from what the SERP actually shows — who ranks, how
    // optimised their titles are, how many slots are forums. It used to average
    // fabricated PA/DA values, so the score inherited the fabrication.
    const composition = difficultyFromSerpComposition(
      serp.map((r) => ({ domain: r.domain, title: r.title, url: r.url })),
      keyword,
      data.search_information?.total_results ?? null,
    );
    if (serp.length > 0) {
      const fromSerp = composition.score;
      base.difficulty = fromSerp;
      base.competition =
        Math.round(Math.min(1, (fromSerp / 100) * 0.7 + base.competition * 0.3) * 100) /
        100;
    }

    const related = (data.related_searches ?? [])
      .map((s) => s.query?.trim())
      .filter((q): q is string => !!q)
      .slice(0, 12)
      .map((q) => estimateKeyword(q, country));

    const questions = (data.related_questions ?? [])
      .map((s) => s.question?.trim())
      .filter((q): q is string => !!q)
      .slice(0, 12)
      .map((q) => estimateKeyword(q, country));

    return { ...base, related, questions, serp };
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const { keyword, country, page, perPage, filters, mode } = params;

    if (keyword.trim() === "") {
      return { keyword, total: 0, results: [] };
    }

    // Ideas come from real Google data: related searches + autocomplete.
    const [serp, auto] = await Promise.all([
      this.fetchCached("google", keyword, country),
      this.fetchCached("google_autocomplete", keyword, country),
    ]);

    const phrases = new Set<string>([keyword.trim().toLowerCase()]);

    for (const s of serp.related_searches ?? []) {
      if (s.query) phrases.add(s.query.trim().toLowerCase());
    }
    for (const s of serp.related_questions ?? []) {
      if (s.question) phrases.add(s.question.trim().toLowerCase());
    }
    for (const s of auto.suggestions ?? []) {
      if (s.value) phrases.add(s.value.trim().toLowerCase());
    }

    let list = [...phrases];

    if (mode === "questions") {
      list = list.filter((p) =>
        /^(what|how|why|when|where|who|is|are|does|do|can|should)\b/.test(p),
      );
    } else if (mode === "exact") {
      list = list.filter((p) => p.includes(keyword.trim().toLowerCase()));
    }

    const all = list
      .map((p) => estimateKeyword(p, country))
      .filter((k) => matches(k, filters))
      .sort((a, b) => b.volume - a.volume);

    const start = (page - 1) * perPage;
    return {
      keyword,
      total: all.length,
      results: all.slice(start, start + perPage),
    };
  }

  analyze(
    keywords: string[],
    country: string,
    language: string,
  ): Promise<Keyword[]> {
    void language;
    // Deliberately no SERP call per keyword — a 500-row bulk run would wipe out
    // a month of quota. Bulk metrics stay estimated.
    return Promise.resolve(
      keywords.map((k) => estimateKeyword(k.trim().toLowerCase(), country)),
    );
  }

  async suggest(keyword: string, country: string): Promise<Suggestions> {
    const auto = await this.fetchCached(
      "google_autocomplete",
      keyword,
      country,
    );
    const google = (auto.suggestions ?? [])
      .map((s) => s.value?.trim())
      .filter((v): v is string => !!v);

    // SerpApi bills per engine. Only Google autocomplete is fetched live; the
    // other columns reuse it rather than spending three more searches.
    const out = {} as Suggestions;
    for (const source of SUGGEST_SOURCES) {
      out[source] = google;
    }
    return out;
  }
}

function matches(k: Keyword, f: SearchParams["filters"]): boolean {
  const words = k.keyword.split(/\s+/).length;

  if (f.volumeMin !== undefined && k.volume < f.volumeMin) return false;
  if (f.volumeMax !== undefined && k.volume > f.volumeMax) return false;
  if (f.difficultyMin !== undefined && k.difficulty < f.difficultyMin) return false;
  if (f.difficultyMax !== undefined && k.difficulty > f.difficultyMax) return false;
  if (f.cpcMin !== undefined && k.cpc < f.cpcMin) return false;
  if (f.cpcMax !== undefined && k.cpc > f.cpcMax) return false;
  if (f.wordsMin !== undefined && words < f.wordsMin) return false;
  if (f.wordsMax !== undefined && words > f.wordsMax) return false;
  if (f.intent !== undefined && k.intent !== f.intent) return false;
  if (f.contains && !matchesTerms(k.keyword, f.contains)) return false;
  if (f.excludes && matchesTerms(k.keyword, f.excludes)) return false;
  return true;
}
