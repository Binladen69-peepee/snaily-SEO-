/**
 * Live KeywordProvider — dual SERP backends (DataForSEO + SerpApi).
 *
 * SERP via getNormalizedSerp():
 *   1. DataForSEO primary (stable when SerpApi quota is exhausted)
 *   2. SerpApi fallback when DataForSEO is missing or fails
 * Authority/backlinks stay on DataForSEO. Never fabricates organic results.
 */

import { dataForSeoConfigured } from "@/lib/dataforseo/config";
import { fetchDataForSeoAutocomplete } from "@/lib/dataforseo/serp";
import { difficultyFromSerpComposition } from "@/lib/keywords/authority";
import {
  enrichSerpWithAuthority,
  normalizedToSerpResults,
} from "@/lib/keywords/enrich-serp";
import { hydrateKeyword, hydrateKeywords, keywordMap } from "@/lib/keywords/hydrate";
import { getNormalizedSerp } from "@/lib/keywords/get-normalized-serp";
import { serpApiConfigured } from "@/lib/keywords/serp-api-guard";
import { prisma } from "@/lib/db";
import { serpFetch } from "@/lib/keywords/providers/serpapi";
import {
  matchesTerms,
  SUGGEST_SOURCES,
  type Keyword,
  type KeywordDetail,
  type KeywordProvider,
  type SearchParams,
  type SearchResult,
  type Suggestions,
} from "@/lib/keywords/types";

const AUTO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class LiveKeywordProvider implements KeywordProvider {
  readonly name =
    serpApiConfigured() && dataForSeoConfigured()
      ? "serpapi+dataforseo"
      : dataForSeoConfigured()
        ? "dataforseo"
        : serpApiConfigured()
          ? "serpapi"
          : "serp";
  readonly isMock = false;
  readonly volumeIsEstimated = false;

  async detail(
    keyword: string,
    country: string,
    language: string,
  ): Promise<KeywordDetail> {
    const serp = await getNormalizedSerp({
      keyword,
      country,
      language,
      depth: 10,
      preferProvider: "dataforseo",
    });

    const rows = await enrichSerpWithAuthority(
      normalizedToSerpResults(keyword, serp.organicResults),
    );

    const base = await hydrateKeyword(keyword, country, language);
    base.results = serp.totalResults ?? base.results;

    const composition = difficultyFromSerpComposition(
      rows.map((r) => ({ domain: r.domain, title: r.title, url: r.url })),
      keyword,
      serp.totalResults,
    );
    if (rows.length > 0) {
      const fromSerp = composition.score;
      base.difficulty = fromSerp;
      base.competition =
        Math.round(
          Math.min(1, (fromSerp / 100) * 0.7 + base.competition * 0.3) * 100,
        ) / 100;
    }

    const related = serp.relatedSearches.slice(0, 12);
    const questions = serp.paa.slice(0, 12);
    const extras = await hydrateKeywords([...related, ...questions], country, language);
    const extraMap = keywordMap(extras);

    return {
      ...base,
      related: related.map((q) => extraMap.get(q.toLowerCase()) ?? { ...base, keyword: q }),
      questions: questions.map((q) => extraMap.get(q.toLowerCase()) ?? { ...base, keyword: q }),
      serp: rows,
    };
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const { keyword, country, page, perPage, filters, mode, language } = params;

    if (keyword.trim() === "") {
      return { keyword, total: 0, results: [] };
    }

    const [serp, suggestions] = await Promise.all([
      getNormalizedSerp({
        keyword,
        country,
        language,
        depth: 10,
        preferProvider: "dataforseo",
      }),
      this.suggest(keyword, country),
    ]);

    const phrases = new Set<string>([keyword.trim().toLowerCase()]);
    for (const q of serp.relatedSearches) phrases.add(q.toLowerCase());
    for (const q of serp.paa) phrases.add(q.toLowerCase());
    for (const q of suggestions.google) phrases.add(q.toLowerCase());

    let list = [...phrases];
    if (mode === "questions") {
      list = list.filter((p) =>
        /^(what|how|why|when|where|who|is|are|does|do|can|should)\b/.test(p),
      );
    } else if (mode === "exact") {
      list = list.filter((p) => p.includes(keyword.trim().toLowerCase()));
    } else if (mode === "long-tail") {
      list = list.filter((p) => p.split(/\s+/).length >= 4);
    } else if (mode === "comparisons") {
      list = list.filter((p) =>
        /\b(vs\.?|versus|or|compared|comparison|alternative|differ)/i.test(p),
      );
    } else if (mode === "buyer-intent") {
      list = list.filter((p) =>
        /\b(best|top|review|cheap|affordable|buy|price|deal|discount|worth|recommend)/i.test(
          p,
        ),
      );
    }

    const hydrated = await hydrateKeywords(list, country, language);
    const all = hydrated
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
    return hydrateKeywords(
      keywords.map((k) => k.trim().toLowerCase()),
      country,
      language,
    );
  }

  async suggest(keyword: string, country: string): Promise<Suggestions> {
    const google = await fetchAutocomplete(keyword, country);
    const out = {} as Suggestions;
    for (const source of SUGGEST_SOURCES) {
      out[source] = google;
    }
    return out;
  }
}

async function fetchAutocomplete(
  keyword: string,
  country: string,
): Promise<string[]> {
  const cacheKey = {
    engine: "autocomplete",
    query: keyword.toLowerCase(),
    country,
  };

  try {
    const cached = await prisma.serpCache.findUnique({
      where: { engine_query_country: cacheKey },
    });
    if (
      cached &&
      Date.now() - cached.fetchedAt.getTime() < AUTO_CACHE_TTL_MS
    ) {
      const payload = cached.payload as { suggestions?: string[] };
      if (Array.isArray(payload.suggestions)) return payload.suggestions;
    }
  } catch {
    // continue
  }

  let suggestions: string[] = [];

  if (dataForSeoConfigured()) {
    try {
      const live = await fetchDataForSeoAutocomplete(keyword, country);
      suggestions = live.suggestions;
    } catch {
      // fall through
    }
  }

  if (suggestions.length === 0 && serpApiConfigured()) {
    try {
      const apiKey = (process.env.SERPAPI_KEY ?? "").trim();
      const auto = await serpFetch<{
        error?: string;
        suggestions?: { value?: string }[];
      }>(apiKey, "google_autocomplete", keyword, country);
      suggestions = (auto.suggestions ?? [])
        .map((s) => s.value?.trim())
        .filter((v): v is string => !!v);
    } catch {
      // empty
    }
  }

  // An empty answer is not worth a week of cache: both providers may simply
  // have been unavailable, and a negative row would outlive the outage.
  if (suggestions.length > 0) {
    try {
      await prisma.serpCache.upsert({
        where: { engine_query_country: cacheKey },
        create: { ...cacheKey, payload: { suggestions } },
        update: { payload: { suggestions }, fetchedAt: new Date() },
      });
    } catch {
      // ignore
    }
  }

  return suggestions;
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
