/**
 * Merge Deep Dive phrase lists into scored rows.
 *
 * Pure CPU — no Prisma, no providers — so the browser can do this itself
 * instead of waiting on a serverless function that used to 504.
 */

import { estimateKeyword } from "@/lib/keywords/estimate";
import { countTabs, type TabCounts } from "@/lib/keywords/intent-tabs";
import {
  SOURCE_BY_ID,
  type DeepDiveSource,
} from "@/lib/keywords/deep-dive-sources";
import { matchesTerms, type Keyword, type KeywordFilters } from "@/lib/keywords/types";

export type SerpSnapshot = {
  estLinks: number | null;
  da3: number | null;
  pages: { domain: string; favicon: string; authority: number | null }[];
  difficulty: number | null;
  fetchedAt: string;
};

export type DeepDiveRow = Keyword & {
  sources: DeepDiveSource[];
  serp: SerpSnapshot | null;
};

export type DeepDiveResult = {
  keyword: string;
  country: string;
  source: DeepDiveSource;
  rows: DeepDiveRow[];
  counts: TabCounts;
  emptySources: string[];
  isMock: boolean;
};

export type SourcePhrases = {
  source: DeepDiveSource;
  phrases: string[];
  isMock: boolean;
};

export type MergeParams = {
  keyword: string;
  country: string;
  sourcePhrases: SourcePhrases[];
  filters: KeywordFilters;
};

function passesFilters(k: Keyword, f: KeywordFilters): boolean {
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

/** Junk that autocomplete returns and nobody wants in a keyword list. */
export function isUsable(phrase: string, seed: string): boolean {
  if (phrase.length < 3 || phrase.length > 120) return false;
  if (!/[a-z]/i.test(phrase)) return false;
  if (/^https?:/i.test(phrase)) return false;
  if (new RegExp(`^${seed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} [a-z]$`).test(phrase)) {
    return false;
  }
  return true;
}

export function mergeDeepDive(params: MergeParams): DeepDiveResult {
  const keyword = params.keyword.trim().toLowerCase();
  const bySource = new Map<string, Set<DeepDiveSource>>();
  const bestRank = new Map<string, number>();
  const emptySources: string[] = [];
  let isMock = false;

  for (const sp of params.sourcePhrases) {
    if (sp.isMock) isMock = true;

    if (sp.phrases.length === 0) {
      emptySources.push(SOURCE_BY_ID.get(sp.source)?.label ?? sp.source);
      continue;
    }

    sp.phrases.forEach((phrase, rank) => {
      const set = bySource.get(phrase) ?? new Set<DeepDiveSource>();
      set.add(sp.source);
      bySource.set(phrase, set);
      bestRank.set(phrase, Math.min(bestRank.get(phrase) ?? rank, rank));
    });
  }

  if (!bySource.has(keyword) && keyword !== "") {
    bySource.set(
      keyword,
      new Set(params.sourcePhrases.map((sp) => sp.source)),
    );
  }

  const allSources = params.sourcePhrases.map((sp) => sp.source);

  const rows: DeepDiveRow[] = [...bySource.entries()]
    .map(([phrase, set]) => ({
      ...estimateKeyword(phrase, params.country),
      sources: [...set],
      serp: null,
    }))
    .filter((row) => passesFilters(row, params.filters))
    .sort(
      (a, b) =>
        (bestRank.get(a.keyword) ?? 999) - (bestRank.get(b.keyword) ?? 999) ||
        b.sources.length - a.sources.length ||
        a.keyword.localeCompare(b.keyword),
    );

  return {
    keyword,
    country: params.country,
    source: allSources[0] ?? "google",
    rows,
    counts: countTabs(rows),
    emptySources: [...new Set(emptySources)],
    isMock,
  };
}
