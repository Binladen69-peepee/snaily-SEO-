/**
 * DataForSEO Google Organic SERP (Live Advanced) + Autocomplete.
 *
 * Endpoint: POST /v3/serp/google/organic/live/advanced
 * Autocomplete: POST /v3/serp/google/autocomplete/live/advanced
 *
 * Item types consumed: organic, people_also_ask, related_searches,
 * plus feature flags from item_types / top-level types.
 */

import { dataForSeoPost } from "@/lib/dataforseo/client";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "@/lib/dataforseo/locations";

export type DfsSerpOrganic = {
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  breadcrumb: string;
  websiteName: string;
  sitelinks: number;
  rating: number | null;
  reviews: number | null;
  publishedDate: string | null;
};

export type DfsSerpParsed = {
  organic: DfsSerpOrganic[];
  paa: string[];
  relatedSearches: string[];
  serpFeatures: string[];
  totalResults: number | null;
  cost: number;
};

type DfsItem = {
  type?: string;
  rank_absolute?: number;
  rank_group?: number;
  title?: string;
  url?: string;
  domain?: string;
  description?: string;
  breadcrumb?: string;
  website_name?: string;
  date?: string;
  links?: unknown[] | null;
  rating?: { value?: number; votes_count?: number } | null;
  items?: Array<{
    type?: string;
    title?: string;
    question?: string;
  } | string> | null;
};

type DfsResultBlock = {
  keyword?: string;
  se_results_count?: number;
  item_types?: string[];
  items?: DfsItem[];
};

export type FetchDfsSerpOptions = {
  keyword: string;
  country: string;
  language?: string;
  /** Organic depth to request (feature-specific; default 10). */
  depth?: number;
  device?: "desktop" | "mobile";
  fetchImpl?: typeof fetch;
  /** City/region for localised SERPs, e.g. "London,England,United Kingdom". */
  locationName?: string;
};

/**
 * How long to wait for a live SERP, scaled to the depth requested.
 *
 * DataForSEO builds a live SERP page by page, so time grows with depth:
 * measured against the live account, depth 10 returns in ~2s, depth 50 in
 * ~18s and depth 100 in ~40s. A flat 45s left the rank tracker's depth-100
 * calls timing out on a slow run, which is the one case that most needs the
 * deep result.
 */
function serpTimeoutMs(depth: number): number {
  return Math.min(120_000, 30_000 + depth * 700);
}

/**
 * Live Google organic SERP with PAA + related searches.
 * Cost scales with depth — callers must pass only what they need.
 */
export async function fetchDataForSeoOrganicSerp(
  opts: FetchDfsSerpOptions,
): Promise<DfsSerpParsed> {
  const depth = Math.min(100, Math.max(1, opts.depth ?? 10));
  const language = dataForSeoLanguageCode(opts.language ?? "en");
  const locationCode = dataForSeoLocationCode(opts.country);

  const payload: Record<string, unknown> = {
    keyword: opts.keyword,
    location_code: locationCode,
    language_code: language,
    device: opts.device ?? "desktop",
    depth,
  };
  // location_name overrides location_code for city/region-level SERPs.
  if (opts.locationName) {
    payload.location_name = opts.locationName;
    delete payload.location_code;
  }

  const response = await dataForSeoPost<DfsResultBlock>(
    "/v3/serp/google/organic/live/advanced",
    [payload],
    { fetchImpl: opts.fetchImpl, timeoutMs: serpTimeoutMs(depth) },
  );

  const block = response.result[0];
  return {
    ...parseDfsSerpBlock(block),
    cost: response.cost,
  };
}

export function parseDfsSerpBlock(block: DfsResultBlock | undefined): Omit<DfsSerpParsed, "cost"> {
  const items = block?.items ?? [];
  const organic: DfsSerpOrganic[] = [];
  const paa: string[] = [];
  const relatedSearches: string[] = [];
  const features = new Set<string>(block?.item_types ?? []);

  for (const item of items) {
    const type = String(item.type ?? "");
    if (type) features.add(type);

    if (type === "organic") {
      const url = String(item.url ?? "");
      const domain =
        String(item.domain ?? "").replace(/^www\./, "") || hostOf(url);
      organic.push({
        position: Number(item.rank_group ?? item.rank_absolute ?? organic.length + 1),
        title: String(item.title ?? url),
        url,
        domain,
        snippet: String(item.description ?? ""),
        breadcrumb: String(item.breadcrumb ?? ""),
        websiteName: String(item.website_name ?? domain),
        sitelinks: Array.isArray(item.links) ? item.links.length : 0,
        rating:
          typeof item.rating?.value === "number" ? item.rating.value : null,
        reviews:
          typeof item.rating?.votes_count === "number"
            ? item.rating.votes_count
            : null,
        publishedDate: item.date ? String(item.date) : null,
      });
      continue;
    }

    if (type === "people_also_ask") {
      for (const child of item.items ?? []) {
        if (typeof child === "string") {
          const q = child.trim();
          if (q) paa.push(q);
          continue;
        }
        const q = String(child.title ?? child.question ?? "").trim();
        if (q) paa.push(q);
      }
      continue;
    }

    if (type === "related_searches") {
      for (const child of item.items ?? []) {
        if (typeof child === "string") {
          const q = child.trim();
          if (q) relatedSearches.push(q);
          continue;
        }
        const q = String(child.title ?? "").trim();
        if (q) relatedSearches.push(q);
      }
    }
  }

  return {
    organic,
    paa: unique(paa).slice(0, 20),
    relatedSearches: unique(relatedSearches).slice(0, 20),
    serpFeatures: [...features],
    totalResults:
      typeof block?.se_results_count === "number" ? block.se_results_count : null,
  };
}

type AutocompleteResult = {
  suggestion?: string;
};

export async function fetchDataForSeoAutocomplete(
  keyword: string,
  country: string,
  opts: { language?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ suggestions: string[]; cost: number }> {
  const response = await dataForSeoPost<{
    items?: AutocompleteResult[];
  }>(
    "/v3/serp/google/autocomplete/live/advanced",
    [
      {
        keyword,
        location_code: dataForSeoLocationCode(country),
        language_code: dataForSeoLanguageCode(opts.language ?? "en"),
      },
    ],
    { fetchImpl: opts.fetchImpl, timeoutMs: 20_000 },
  );

  const suggestions = (response.result[0]?.items ?? [])
    .map((i) => String(i.suggestion ?? "").trim())
    .filter((s) => s !== "");

  return { suggestions: unique(suggestions), cost: response.cost };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
