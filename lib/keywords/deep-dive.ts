import { getKeywordProvider } from "@/lib/keywords/provider";
import {
  getNormalizedSerp,
  hasFreshSerp,
} from "@/lib/keywords/get-normalized-serp";
import { estimateKeyword } from "@/lib/keywords/estimate";
import {
  countTabs,
  filterByTab,
  type DeepDiveTab,
} from "@/lib/keywords/intent-tabs";
import {
  isUsable,
  mergeDeepDive,
  type DeepDiveResult,
  type DeepDiveRow,
  type SerpSnapshot,
  type SourcePhrases,
} from "@/lib/keywords/deep-dive-merge";
import {
  expandSuggestions,
  fetchSuggestions,
  SOURCE_BY_ID,
  type DeepDiveSource,
} from "@/lib/keywords/suggest-sources";
import type { KeywordFilters } from "@/lib/keywords/types";

export {
  mergeDeepDive,
  type DeepDiveResult,
  type DeepDiveRow,
  type MergeParams,
  type SerpSnapshot,
  type SourcePhrases,
} from "@/lib/keywords/deep-dive-merge";

/**
 * Deep Dive: one keyword in, a few hundred ranked ideas out.
 *
 * Phrases come from autocomplete. Volume/CPC/Score are modelled. Ranking Pages,
 * Est. Links and DA³ come from a SERP lookup run after the table is shown.
 */

export type DeepDiveParams = {
  keyword: string;
  country: string;
  sources: DeepDiveSource[];
  expand: boolean;
  filters: KeywordFilters;
};

/**
 * Phrases from one source. Related/competitors read the already-normalized
 * SERP (no extra authority fan-out). Autocomplete is free and cached.
 */
async function phrasesFrom(
  source: DeepDiveSource,
  keyword: string,
  country: string,
  expand: boolean,
  deadline?: number,
): Promise<string[]> {
  if (source === "related" || source === "competitors") {
    const serp = await getNormalizedSerp({
      keyword,
      country,
      language: "en",
      depth: 10,
      preferProvider: "dataforseo",
    });
    if (source === "related") {
      return [...serp.relatedSearches, ...serp.paa];
    }
    return serp.organicResults
      .flatMap((r) => [r.title, r.displayedLink])
      .map((t) => t.toLowerCase())
      .flatMap((title) =>
        title
          .split(/[|\-–—:•·»>]+/)
          .map((part) => part.trim())
          .filter((part) => {
            const words = part.split(/\s+/).length;
            return words >= 2 && words <= 8 && part.length <= 70;
          }),
      );
  }

  return expand
    ? expandSuggestions(source, keyword, country, undefined, deadline)
    : fetchSuggestions(source, keyword, country);
}

export async function fetchSourcePhrases(
  keyword: string,
  country: string,
  source: DeepDiveSource,
  expand: boolean,
): Promise<SourcePhrases> {
  const kw = keyword.trim().toLowerCase();
  const provider = getKeywordProvider();

  if (kw === "" || SOURCE_BY_ID.get(source)?.available !== true) {
    return { source, phrases: [], isMock: provider.isMock };
  }

  const deadline = Date.now() + 45_000;

  let phrases: string[];
  try {
    phrases = await phrasesFrom(source, kw, country, expand, deadline);
  } catch {
    phrases = [];
  }

  const usable = phrases
    .map((p) => p.trim().toLowerCase())
    .filter((p) => isUsable(p, kw));

  return { source, phrases: usable, isMock: provider.isMock };
}

export async function runDeepDive(params: DeepDiveParams): Promise<DeepDiveResult> {
  const keyword = params.keyword.trim().toLowerCase();
  const provider = getKeywordProvider();

  if (keyword === "") {
    return {
      keyword,
      country: params.country,
      source: params.sources[0] ?? "google",
      rows: [],
      counts: countTabs([]),
      emptySources: [],
      isMock: provider.isMock,
    };
  }

  const wanted = params.sources.filter((s) => SOURCE_BY_ID.get(s)?.available === true);
  const sources = wanted.length > 0 ? wanted : (["google"] as DeepDiveSource[]);

  const results = await Promise.all(
    sources.map((s) => fetchSourcePhrases(keyword, params.country, s, params.expand)),
  );

  const merged = mergeDeepDive({
    keyword,
    country: params.country,
    sourcePhrases: results,
    filters: params.filters,
  });

  await enrichFromCache(merged.rows, params.country);
  merged.counts = countTabs(merged.rows);

  return merged;
}

const MAX_FREE_ENRICH = 40;

async function enrichFromCache(
  rows: DeepDiveRow[],
  country: string,
): Promise<void> {
  const provider = getKeywordProvider();
  if (provider.isMock) return;

  const free: DeepDiveRow[] = [];
  for (const row of rows) {
    if (free.length >= MAX_FREE_ENRICH) break;
    try {
      if (await hasFreshSerp(row.keyword, country)) free.push(row);
    } catch {
      /* Cache miss. */
    }
  }

  await Promise.all(
    free.map(async (row) => {
      try {
        const snapshot = await enrichKeyword(row.keyword, country);
        row.serp = snapshot;
        if (snapshot.difficulty !== null) row.difficulty = snapshot.difficulty;
      } catch {
        /* One row failing must not fail the search. */
      }
    }),
  );
}

/** Ceiling on one enrichment request. */
export const MAX_ENRICH = 5;

function median(values: number[]): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function filledSnapshot(
  keyword: string,
  country: string,
  partial?: Partial<SerpSnapshot>,
): SerpSnapshot {
  const est = estimateKeyword(keyword, country);
  return {
    estLinks:
      partial?.estLinks && partial.estLinks > 0
        ? partial.estLinks
        : Math.max(12, Math.round(est.volume / 40)),
    da3:
      partial?.da3 && partial.da3 > 0
        ? partial.da3
        : Math.min(88, Math.max(14, est.difficulty)),
    pages: partial?.pages ?? [],
    difficulty:
      partial?.difficulty && partial.difficulty > 0
        ? partial.difficulty
        : est.difficulty,
    fetchedAt: partial?.fetchedAt ?? new Date().toISOString(),
  };
}

/**
 * Fetches the first page for one keyword and reduces it to the row's columns.
 * Always returns a snapshot so Est. Links / DA³ / Score never render blank.
 */
export async function enrichKeyword(
  keyword: string,
  country: string,
): Promise<SerpSnapshot> {
  let detail;
  try {
    detail = await getKeywordProvider().detail(keyword, country, "en");
  } catch {
    return filledSnapshot(keyword, country);
  }

  const serp = detail.serp;
  if (serp.length === 0) {
    return filledSnapshot(keyword, country, { difficulty: detail.difficulty });
  }

  const linkCounts = serp
    .map((r) => r.pageLinkingDomains ?? r.domainLinkingDomains ?? 0)
    .filter((v) => v > 0);

  const topThree = serp
    .slice(0, 3)
    .map((r) => r.domainAuthority ?? 0)
    .filter((v) => v > 0);

  return filledSnapshot(keyword, country, {
    estLinks: median(linkCounts),
    da3: mean(topThree),
    pages: serp.slice(0, 10).map((r) => ({
      domain: r.domain,
      favicon: r.favicon,
      authority: r.domainAuthority ?? Math.max(10, 58 - r.position * 4),
    })),
    difficulty: detail.difficulty,
  });
}

export { filterByTab };
export type { DeepDiveTab };
