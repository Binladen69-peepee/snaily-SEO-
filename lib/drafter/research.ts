/**
 * Normalized Drafter research object.
 *
 * DataForSEO (primary) or SerpApi (fallback) populate this once per drafting
 * job. AI stages consume slices of it — never raw provider payloads, and never
 * as a substitute for recipe / WordPress / GSC truth.
 */

import type { NormalizedSerp, SerpProviderId } from "@/lib/keywords/serp-normalized";
import { tokenize } from "@/lib/text";

export type DrafterSearchIntent =
  | "informational"
  | "transactional"
  | "navigational"
  | "commercial"
  | "unknown";

export type DrafterResearchTerm = {
  term: string;
  frequency: number;
  source: "serp_title" | "serp_body" | "related_search";
  relevance: "high" | "medium" | "low";
};

export type DrafterTopResult = {
  position: number;
  title: string;
  url: string;
  domain: string;
};

export type DrafterDifficultySignals = {
  difficulty: number;
  volume: number;
  cpc: number;
};

export type DrafterResearchProvider =
  | SerpProviderId
  | "cache"
  | "unavailable";

/**
 * Single research snapshot for the Drafter pipeline.
 *
 * Built once from a normalized SERP (+ optional page-crawl terms). Stages read
 * this object; they do not call providers.
 */
export type DrafterResearch = {
  keyword: string;
  searchIntent: DrafterSearchIntent;
  topResults: DrafterTopResult[];
  serpFeatures: string[];
  paa: string[];
  relatedSearches: string[];
  recurringTerms: DrafterResearchTerm[];
  competitorDomains: string[];
  competitorTitles: string[];
  /** Terms extracted from top-15 SERP titles for title scoring. */
  titleTerms: DrafterResearchTerm[];
  difficultySignals: DrafterDifficultySignals | null;
  provider: DrafterResearchProvider;
  retrievedAt: string;
  location: string;
  language: string;
  cacheHit: boolean;
  /** False when no SERP provider returned usable organic results. */
  available: boolean;
};

/** High-signal ingredients that often leak from unrelated recipes into FAQs. */
const GROUNDING_INGREDIENTS = [
  "coconut milk",
  "coconut cream",
  "heavy cream",
  "sour cream",
  "cream cheese",
  "white wine",
  "red wine",
  "butter",
  "eggs",
  "egg",
  "honey",
  "parmesan",
  "cheddar",
  "milk",
  "yogurt",
  "yoghurt",
  "buttermilk",
  "chicken stock",
  "beef stock",
  "fish sauce",
  "bacon",
  "gelatin",
  "gelatine",
  "masa harina",
  "jackfruit",
  "tamale",
];

const TITLE_STOP = new Set([
  "recipe",
  "recipes",
  "best",
  "easy",
  "homemade",
  "how",
  "make",
  "with",
  "from",
  "the",
  "and",
  "for",
  "you",
  "your",
  "this",
  "that",
  "guide",
  "tips",
  "ultimate",
  "perfect",
  "simple",
  "quick",
  "vegan",
  "vegetarian",
  "gluten",
  "free",
  "healthy",
]);

export function emptyDrafterResearch(
  keyword: string,
  location = "us",
  language = "en",
): DrafterResearch {
  return {
    keyword,
    searchIntent: "unknown",
    topResults: [],
    serpFeatures: [],
    paa: [],
    relatedSearches: [],
    recurringTerms: [],
    competitorDomains: [],
    competitorTitles: [],
    titleTerms: [],
    difficultySignals: null,
    provider: "unavailable",
    retrievedAt: new Date().toISOString(),
    location,
    language,
    cacheHit: false,
    available: false,
  };
}

/** Infer coarse search intent from SERP composition + keyword shape. */
export function inferSearchIntent(
  keyword: string,
  serpFeatures: string[],
  paaCount: number,
): DrafterSearchIntent {
  const k = keyword.toLowerCase();
  if (/\b(buy|price|cheap|near me|order|shop)\b/.test(k)) return "transactional";
  if (/\b(login|official|website|brand)\b/.test(k)) return "navigational";
  if (/\b(best|vs|versus|review|top)\b/.test(k) || serpFeatures.includes("shopping")) {
    return "commercial";
  }
  if (
    /\b(how|what|why|recipe|make|cook)\b/.test(k) ||
    paaCount > 0 ||
    serpFeatures.includes("people_also_ask")
  ) {
    return "informational";
  }
  return "unknown";
}

/**
 * Extract recurring vocabulary from top SERP titles.
 *
 * Frequency is title hits among the organic set. Relevance is heuristic —
 * keyword overlap ranks higher; generic filler is dropped.
 */
export function extractTitleTerms(
  titles: string[],
  keyword: string,
  limit = 15,
): DrafterResearchTerm[] {
  const kwTokens = new Set(tokenize(keyword).filter((t) => t.length > 2));
  const counts = new Map<string, number>();

  for (const title of titles) {
    const seen = new Set<string>();
    for (const token of tokenize(title)) {
      if (token.length < 3 || TITLE_STOP.has(token) || seen.has(token)) continue;
      seen.add(token);
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([term, frequency]) => {
      const inKeyword = kwTokens.has(term);
      const relevance: DrafterResearchTerm["relevance"] =
        inKeyword || frequency >= 4
          ? "high"
          : frequency >= 2
            ? "medium"
            : "low";
      return {
        term,
        frequency,
        source: "serp_title" as const,
        relevance,
      };
    })
    .filter((t) => t.relevance !== "low" || t.frequency >= 2)
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      if (rank[a.relevance] !== rank[b.relevance]) {
        return rank[a.relevance] - rank[b.relevance];
      }
      return b.frequency - a.frequency;
    })
    .slice(0, limit);
}

/**
 * Drop PAA questions that introduce ingredients not present in the recipe.
 *
 * PAA is research evidence for FAQ *topics*, never an answer source. A
 * question that presupposes coconut milk when the paste has none is rejected.
 */
export function filterPaaForRecipe(
  paa: string[],
  recipeText: string,
  keyword = "",
): string[] {
  const hay = `${recipeText} ${keyword}`.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of paa) {
    const q = raw.trim().replace(/\s+/g, " ");
    if (q.length < 8) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;

    let contaminated = false;
    for (const ingredient of GROUNDING_INGREDIENTS) {
      if (!new RegExp(`\\b${ingredient.replace(/\s+/g, "\\s+")}\\b`, "i").test(q)) {
        continue;
      }
      if (!hay.includes(ingredient)) {
        contaminated = true;
        break;
      }
    }
    if (contaminated) continue;
    // FAQ writer is forbidden from health/nutrition claims; those PAA are noise.
    if (/\b(healthier|healthy|nutrition|calories|calorie|protein)\b/i.test(q)) {
      continue;
    }

    seen.add(key);
    out.push(q.endsWith("?") ? q : `${q}?`);
  }

  return out;
}

/** Build DrafterResearch from one NormalizedSerp response. */
export function buildDrafterResearch(input: {
  serp: NormalizedSerp;
  difficultySignals?: DrafterDifficultySignals | null;
  /** Body-mined terms from competitor page crawls (optional enrichment). */
  bodyTerms?: string[];
  /** Override provider label when served via cache of a known provider. */
  providerOverride?: DrafterResearchProvider;
}): DrafterResearch {
  const { serp } = input;
  const organic = serp.organicResults.slice(0, 15);
  const titles = organic.map((r) => r.title).filter((t) => t.trim() !== "");
  const titleTerms = extractTitleTerms(titles, serp.keyword);

  const relatedTerms: DrafterResearchTerm[] = serp.relatedSearches
    .slice(0, 12)
    .map((term, i) => ({
      term,
      frequency: Math.max(1, 12 - i),
      source: "related_search" as const,
      relevance: "medium" as const,
    }));

  const bodyTerms: DrafterResearchTerm[] = (input.bodyTerms ?? [])
    .slice(0, 20)
    .map((term, i) => ({
      term,
      frequency: Math.max(1, 20 - i),
      source: "serp_body" as const,
      relevance: (i < 8 ? "high" : "medium") as DrafterResearchTerm["relevance"],
    }));

  const provider: DrafterResearchProvider =
    input.providerOverride ??
    (serp.fromCache ? "cache" : serp.provider);

  return {
    keyword: serp.keyword,
    searchIntent: inferSearchIntent(
      serp.keyword,
      serp.serpFeatures,
      serp.paa.length,
    ),
    topResults: organic.map((r) => ({
      position: r.position,
      title: r.title,
      url: r.url,
      domain: r.domain,
    })),
    serpFeatures: [...serp.serpFeatures],
    paa: [...serp.paa],
    relatedSearches: [...serp.relatedSearches],
    recurringTerms: [...titleTerms.slice(0, 8), ...bodyTerms, ...relatedTerms].slice(
      0,
      24,
    ),
    competitorDomains: [
      ...new Set(organic.map((r) => r.domain).filter((d) => d !== "")),
    ],
    competitorTitles: titles.slice(0, 15),
    titleTerms,
    difficultySignals: input.difficultySignals ?? null,
    provider,
    retrievedAt: serp.retrievedAt,
    location: serp.location,
    language: serp.language,
    cacheHit: serp.fromCache,
    available: organic.length > 0,
  };
}

/**
 * Rebuild a research object from a stored ArticleBrief when the live SERP
 * snapshot is not re-fetched (reuse path — zero provider calls).
 */
export function researchFromBriefFields(input: {
  keyword: string;
  location?: string;
  language?: string;
  serp: Array<{ position: number; title: string; url: string; domain: string }>;
  questions?: string[];
  terms?: string[];
  difficulty?: number;
  volume?: number;
  cpc?: number;
  provider?: DrafterResearchProvider;
  retrievedAt?: string;
  paa?: string[];
  relatedSearches?: string[];
  serpFeatures?: string[];
  titleWords?: string[];
  cacheHit?: boolean;
}): DrafterResearch {
  if (input.serp.length === 0 && (input.paa ?? []).length === 0) {
    return emptyDrafterResearch(
      input.keyword,
      input.location ?? "us",
      input.language ?? "en",
    );
  }

  const titles = input.serp.map((r) => r.title);
  const titleTerms =
    (input.titleWords ?? []).length > 0
      ? (input.titleWords ?? []).map((term, i) => ({
          term,
          frequency: Math.max(1, 12 - i),
          source: "serp_title" as const,
          relevance: (i < 5 ? "high" : "medium") as DrafterResearchTerm["relevance"],
        }))
      : extractTitleTerms(titles, input.keyword);

  const paa = input.paa ?? input.questions ?? [];
  const features = input.serpFeatures ?? [];

  return {
    keyword: input.keyword,
    searchIntent: inferSearchIntent(input.keyword, features, paa.length),
    topResults: input.serp.slice(0, 15),
    serpFeatures: features,
    paa,
    relatedSearches: input.relatedSearches ?? [],
    recurringTerms: [
      ...titleTerms.slice(0, 8),
      ...(input.terms ?? []).slice(0, 12).map((term, i) => ({
        term,
        frequency: Math.max(1, 12 - i),
        source: "serp_body" as const,
        relevance: "medium" as const,
      })),
    ],
    competitorDomains: [
      ...new Set(input.serp.map((r) => r.domain).filter((d) => d !== "")),
    ],
    competitorTitles: titles.slice(0, 15),
    titleTerms,
    difficultySignals:
      input.difficulty !== undefined
        ? {
            difficulty: input.difficulty,
            volume: input.volume ?? 0,
            cpc: input.cpc ?? 0,
          }
        : null,
    provider: input.provider ?? "cache",
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    location: input.location ?? "us",
    language: input.language ?? "en",
    cacheHit: input.cacheHit ?? true,
    available: input.serp.length > 0,
  };
}

export function parseDrafterResearch(value: unknown): DrafterResearch | null {
  if (value === null || typeof value !== "object") return null;
  const r = value as Partial<DrafterResearch>;
  if (typeof r.keyword !== "string" || !Array.isArray(r.topResults)) return null;
  if (typeof r.available !== "boolean") return null;
  return value as DrafterResearch;
}

/** Compact summary for the editor Search Research panel. */
export function researchPanelSummary(research: DrafterResearch | null): {
  providerLabel: string;
  available: boolean;
  topResults: number;
  paa: number;
  serpFeatures: number;
  relatedSearches: number;
  cacheHit: boolean;
} {
  if (research === null || !research.available) {
    return {
      providerLabel: "Unavailable",
      available: false,
      topResults: 0,
      paa: 0,
      serpFeatures: 0,
      relatedSearches: 0,
      cacheHit: false,
    };
  }
  const label =
    research.provider === "dataforseo"
      ? "DataForSEO"
      : research.provider === "serpapi"
        ? "SerpApi"
        : research.provider === "cache"
          ? "Cached SERP"
          : "Unavailable";
  return {
    providerLabel: label,
    available: true,
    topResults: research.topResults.length,
    paa: research.paa.length,
    serpFeatures: research.serpFeatures.length,
    relatedSearches: research.relatedSearches.length,
    cacheHit: research.cacheHit,
  };
}

/**
 * Section-scoped research slices for AI prompts.
 *
 * STEPS get nothing — cooking instructions must not absorb competitor SERP.
 */
export type ResearchPromptSlice = {
  terms?: string[];
  questions?: string[];
  headings?: string[];
  intent?: string;
  titleTerms?: string[];
  note?: string;
};

export function researchSliceForSections(
  research: DrafterResearch | null | undefined,
  keys: string[],
  opts?: { recipeText?: string },
): ResearchPromptSlice {
  if (!research?.available) return {};

  const onlySteps =
    keys.length > 0 && keys.every((k) => k === "steps");
  if (onlySteps) return {};

  const recipeText = opts?.recipeText ?? "";
  const filteredPaa = filterPaaForRecipe(
    research.paa,
    recipeText,
    research.keyword,
  );

  const compactTerms = research.recurringTerms
    .filter((t) => t.relevance !== "low")
    .slice(0, 8)
    .map((t) => t.term);

  const titleTerms = research.titleTerms
    .filter((t) => t.relevance !== "low")
    .slice(0, 10)
    .map((t) => t.term);

  if (keys.includes("faq") && keys.every((k) => k === "faq")) {
    return {
      questions: filteredPaa.slice(0, 8),
      intent: research.searchIntent,
      note: "PAA questions are topic suggestions only. Answer only from RECIPE_CONTEXT.",
    };
  }

  if (keys.some((k) => k === "intro" || k === "hook")) {
    return {
      terms: compactTerms.slice(0, 6),
      intent: research.searchIntent,
      questions: filteredPaa.slice(0, 3),
    };
  }

  if (keys.includes("why") && !keys.includes("intro")) {
    return {
      terms: compactTerms.slice(0, 3),
      intent: research.searchIntent,
    };
  }

  if (keys.some((k) => k === "ingredients" || k === "serving" || k === "related")) {
    return {
      terms: compactTerms.slice(0, 2),
    };
  }

  // Outline / mixed / SEO metadata callers
  if (keys.includes("seo") || keys.includes("metadata") || keys.includes("outline")) {
    return {
      terms: compactTerms,
      questions: filteredPaa.slice(0, 8),
      titleTerms,
      intent: research.searchIntent,
      headings: research.competitorTitles.slice(0, 8),
    };
  }

  return {
    terms: compactTerms.slice(0, 6),
    questions: filteredPaa.slice(0, 4),
    intent: research.searchIntent,
  };
}

export function providerDisplayName(provider: DrafterResearchProvider): string {
  if (provider === "dataforseo") return "DataForSEO";
  if (provider === "serpapi") return "SerpApi";
  if (provider === "cache") return "Cached SERP";
  return "Unavailable";
}
