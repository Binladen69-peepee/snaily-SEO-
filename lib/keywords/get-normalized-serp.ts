/**
 * Single entry point for live SERP data across Snaily.
 *
 * Dual-provider load sharing:
 *   1. Fresh SerpCache (either provider)
 *   2. DataForSEO — the primary provider for every feature
 *   3. SerpApi as fallback when DataForSEO is missing, fails, or is not configured
 *   4. Stale cache → clean error
 *
 * Only an explicit preferProvider: "serpapi" puts SerpApi first. Defaulting to
 * DataForSEO means a new call site cannot silently reintroduce SerpApi-first.
 *
 * Authority/backlinks stay on DataForSEO separately — SerpApi does not supply those.
 * Never fabricates organic results.
 */

import { dataForSeoConfigured } from "@/lib/dataforseo/config";
import { DataForSeoError } from "@/lib/dataforseo/errors";
import { fetchDataForSeoOrganicSerp } from "@/lib/dataforseo/serp";
import { prisma } from "@/lib/db";
import { faviconFor } from "@/lib/keywords/enrich-serp";
import {
  markSerpApiQuotaExhausted,
  serpApiFallbackAvailable,
} from "@/lib/keywords/serp-api-guard";
import type {
  GetNormalizedSerpParams,
  NormalizedOrganicResult,
  NormalizedSerp,
  SerpProviderId,
} from "@/lib/keywords/serp-normalized";
import { ProviderError } from "@/lib/keywords/types";
import { serpFetch } from "@/lib/keywords/providers/serpapi";

/** Engine key for normalized rows in SerpCache. */
export const SERP_NORM_ENGINE = "serp_norm";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type UsageEvent = {
  endpoint: string;
  provider: SerpProviderId | "cache";
  cacheHit: boolean;
  estimatedCost: number;
  at: string;
};

const usageLog: UsageEvent[] = [];

function recordUsage(event: Omit<UsageEvent, "at">): void {
  usageLog.push({ ...event, at: new Date().toISOString() });
  if (usageLog.length > 200) usageLog.shift();
}

export function recentSerpUsage(): UsageEvent[] {
  return [...usageLog];
}

function cacheQueryKey(params: {
  keyword: string;
  language: string;
  depth: number;
  device: string;
}): string {
  return [
    params.keyword.toLowerCase().trim(),
    `hl=${params.language}`,
    `depth=${String(params.depth)}`,
    `device=${params.device}`,
  ].join("|");
}

export async function hasFreshSerp(
  query: string,
  country: string,
  opts: { depth?: number; language?: string; device?: string } = {},
): Promise<boolean> {
  const language = opts.language ?? "en";
  const depth = opts.depth ?? 10;
  const device = opts.device ?? "desktop";
  const key = {
    engine: SERP_NORM_ENGINE,
    query: cacheQueryKey({ keyword: query, language, depth, device }),
    country,
  };

  const cached = await prisma.serpCache.findUnique({
    where: { engine_query_country: key },
    select: { fetchedAt: true },
  });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return true;
  }

  // Legacy SerpApi cache still counts as fresh for depth ≤ 10.
  if (depth <= 10) {
    const legacy = await prisma.serpCache.findUnique({
      where: {
        engine_query_country: {
          engine: "google",
          query: query.toLowerCase(),
          country,
        },
      },
      select: { fetchedAt: true },
    });
    return (
      legacy !== null && Date.now() - legacy.fetchedAt.getTime() < CACHE_TTL_MS
    );
  }
  return false;
}

export async function getNormalizedSerp(
  params: GetNormalizedSerpParams,
): Promise<NormalizedSerp> {
  const keyword = params.keyword.trim();
  if (keyword === "") {
    throw new ProviderError("Keyword is empty.", "serp");
  }

  const language = (params.language ?? "en").trim() || "en";
  const depth = Math.min(100, Math.max(1, params.depth ?? 10));
  const device = params.device ?? "desktop";
  const country = params.country || "us";

  // DataForSEO is the primary SERP provider project-wide; SerpApi leads only
  // when a caller explicitly asks for it.
  const preferDfs = params.preferProvider !== "serpapi";

  const cacheKey = {
    engine: SERP_NORM_ENGINE,
    query: cacheQueryKey({ keyword, language, depth, device }),
    country,
  };

  const cached = await prisma.serpCache.findUnique({
    where: { engine_query_country: cacheKey },
  });

  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    const payload = cached.payload as NormalizedSerp;
    if (payload && Array.isArray(payload.organicResults)) {
      recordUsage({
        endpoint: "serp_norm",
        provider: "cache",
        cacheHit: true,
        estimatedCost: 0,
      });
      return { ...payload, fromCache: true, estimatedCost: 0 };
    }
  }

  // Legacy SerpApi rows are only replayed for a caller that asked for SerpApi;
  // otherwise every feature would keep serving old SerpApi data.
  if (depth <= 10 && !preferDfs) {
    const legacy = await readLegacySerpApiCache(keyword, country);
    if (legacy) {
      await writeNormCache(cacheKey, legacy);
      recordUsage({
        endpoint: "serp_norm/legacy",
        provider: "cache",
        cacheHit: true,
        estimatedCost: 0,
      });
      return { ...legacy, fromCache: true, estimatedCost: 0 };
    }
  }

  const errors: Error[] = [];

  const trySerpApi = async (): Promise<NormalizedSerp | null> => {
    if (params.skipSerpApi || !(await serpApiFallbackAvailable())) return null;
    try {
      const normalized = await fetchViaSerpApi({
        keyword,
        country,
        language,
        depth,
        device,
      });
      await writeNormCache(cacheKey, normalized);
      recordUsage({
        endpoint: "serpapi/google",
        provider: "serpapi",
        cacheHit: false,
        estimatedCost: 0,
      });
      return normalized;
    } catch (err) {
      if (isSerpApiQuotaError(err)) markSerpApiQuotaExhausted();
      errors.push(err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  };

  const tryDataForSeo = async (): Promise<NormalizedSerp | null> => {
    if (!dataForSeoConfigured()) return null;
    try {
      const live = await fetchDataForSeoOrganicSerp({
        keyword,
        country,
        language,
        depth,
        device,
      });
      const normalized = toNormalized({
        keyword,
        location: country,
        language,
        depth,
        device,
        provider: "dataforseo",
        organic: live.organic.map((o) => ({
          position: o.position,
          title: o.title,
          url: o.url,
          domain: o.domain,
          snippet: o.snippet,
          displayedLink: o.breadcrumb,
          sourceName: o.websiteName,
          favicon: faviconFor(o.domain),
          publishedDate: o.publishedDate,
          sitelinks: o.sitelinks,
          rating: o.rating,
          reviews: o.reviews,
        })),
        paa: live.paa,
        relatedSearches: live.relatedSearches,
        serpFeatures: live.serpFeatures,
        totalResults: live.totalResults,
        estimatedCost: live.cost,
      });
      await writeNormCache(cacheKey, normalized);
      recordUsage({
        endpoint: "serp/google/organic/live/advanced",
        provider: "dataforseo",
        cacheHit: false,
        estimatedCost: live.cost,
      });
      return normalized;
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  };

  // DataForSEO primary, SerpApi as fallback — for every feature.
  if (preferDfs) {
    const dfs = await tryDataForSeo();
    if (dfs) return dfs;
    const serpApi = await trySerpApi();
    if (serpApi) return serpApi;
  } else {
    const serpApi = await trySerpApi();
    if (serpApi) return serpApi;
    const dfs = await tryDataForSeo();
    if (dfs) return dfs;
  }

  const lastError = errors.at(-1) ?? null;

  // Stale cache is better than a blank SERP when both providers fail.
  if (cached?.payload) {
    const payload = cached.payload as NormalizedSerp;
    if (payload && Array.isArray(payload.organicResults)) {
      recordUsage({
        endpoint: "serp_norm/stale",
        provider: "cache",
        cacheHit: true,
        estimatedCost: 0,
      });
      return { ...payload, fromCache: true, estimatedCost: 0 };
    }
  }

  if (lastError instanceof DataForSeoError) {
    throw new ProviderError(lastError.message, "dataforseo");
  }
  if (lastError instanceof ProviderError) throw lastError;

  throw new ProviderError(
    lastError?.message ??
      "No SERP provider is available. Configure DataForSEO or SerpApi.",
    "serp",
  );
}

function toNormalized(input: {
  keyword: string;
  location: string;
  language: string;
  depth: number;
  device: "desktop" | "mobile";
  provider: SerpProviderId;
  organic: NormalizedOrganicResult[];
  paa: string[];
  relatedSearches: string[];
  serpFeatures: string[];
  totalResults: number | null;
  estimatedCost: number;
}): NormalizedSerp {
  return {
    keyword: input.keyword,
    location: input.location,
    language: input.language,
    depth: input.depth,
    device: input.device,
    organicResults: input.organic.slice(0, input.depth),
    paa: input.paa,
    relatedSearches: input.relatedSearches,
    serpFeatures: input.serpFeatures,
    totalResults: input.totalResults,
    provider: input.provider,
    retrievedAt: new Date().toISOString(),
    fromCache: false,
    estimatedCost: input.estimatedCost,
  };
}

async function writeNormCache(
  key: { engine: string; query: string; country: string },
  payload: NormalizedSerp,
): Promise<void> {
  try {
    await prisma.serpCache.upsert({
      where: { engine_query_country: key },
      create: { ...key, payload: payload as object },
      update: { payload: payload as object, fetchedAt: new Date() },
    });
  } catch {
    // Cache write must not fail the SERP response.
  }
}

type LegacySerpApi = {
  error?: string;
  search_information?: { total_results?: number };
  organic_results?: Array<{
    position?: number;
    title?: string;
    link?: string;
    displayed_link?: string;
    snippet?: string;
    favicon?: string;
    source?: string;
    date?: string;
    sitelinks?: { inline?: unknown[]; expanded?: unknown[]; list?: unknown[] };
    rich_snippet?: {
      top?: { detected_extensions?: { rating?: number; reviews?: number } };
      bottom?: { detected_extensions?: { rating?: number; reviews?: number } };
    };
  }>;
  related_searches?: { query?: string }[];
  related_questions?: { question?: string }[];
  ads?: unknown[];
  ai_overview?: unknown;
  knowledge_graph?: unknown;
  local_results?: unknown;
  shopping_results?: unknown[];
};

async function readLegacySerpApiCache(
  keyword: string,
  country: string,
): Promise<NormalizedSerp | null> {
  try {
    const row = await prisma.serpCache.findUnique({
      where: {
        engine_query_country: {
          engine: "google",
          query: keyword.toLowerCase(),
          country,
        },
      },
    });
    if (!row || Date.now() - row.fetchedAt.getTime() >= CACHE_TTL_MS) {
      return null;
    }
    return normalizeSerpApiPayload(
      row.payload as LegacySerpApi,
      keyword,
      country,
      "en",
      10,
      "desktop",
      true,
    );
  } catch {
    return null;
  }
}

async function fetchViaSerpApi(opts: {
  keyword: string;
  country: string;
  language: string;
  depth: number;
  device: "desktop" | "mobile";
}): Promise<NormalizedSerp> {
  const apiKey = (process.env.SERPAPI_KEY ?? "").trim();
  const extra: Record<string, string> = {
    num: String(Math.min(100, opts.depth)),
    hl: opts.language,
  };
  if (opts.device === "mobile") extra.device = "mobile";

  const payload = await serpFetch<LegacySerpApi>(
    apiKey,
    "google",
    opts.keyword,
    opts.country,
    extra,
  );
  return normalizeSerpApiPayload(
    payload,
    opts.keyword,
    opts.country,
    opts.language,
    opts.depth,
    opts.device,
    false,
  );
}

export function normalizeSerpApiPayload(
  data: LegacySerpApi,
  keyword: string,
  country: string,
  language: string,
  depth: number,
  device: "desktop" | "mobile",
  fromCache: boolean,
): NormalizedSerp {
  const features: string[] = ["organic"];
  if (data.ads?.length) features.push("paid");
  if (data.ai_overview) features.push("ai_overview");
  if (data.knowledge_graph) features.push("knowledge_graph");
  if (data.local_results) features.push("local_pack");
  if (data.shopping_results?.length) features.push("shopping");
  if ((data.related_questions ?? []).length) features.push("people_also_ask");
  if ((data.related_searches ?? []).length) features.push("related_searches");

  const organic: NormalizedOrganicResult[] = (data.organic_results ?? [])
    .slice(0, depth)
    .map((r, i) => {
      const url = r.link ?? "";
      let domain = "";
      try {
        domain = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        domain = (r.source ?? "").replace(/^www\./, "");
      }
      const rich =
        r.rich_snippet?.top?.detected_extensions ??
        r.rich_snippet?.bottom?.detected_extensions;
      const sitelinks =
        (r.sitelinks?.inline?.length ?? 0) +
        (r.sitelinks?.expanded?.length ?? 0) +
        (r.sitelinks?.list?.length ?? 0);

      return {
        position: r.position ?? i + 1,
        title: r.title ?? url,
        url,
        domain,
        snippet: r.snippet ?? "",
        displayedLink: r.displayed_link ?? "",
        sourceName: r.source ?? domain,
        favicon: r.favicon ?? faviconFor(domain),
        publishedDate: r.date ?? null,
        sitelinks,
        rating: typeof rich?.rating === "number" ? rich.rating : null,
        reviews: typeof rich?.reviews === "number" ? rich.reviews : null,
      };
    });

  return {
    keyword,
    location: country,
    language,
    depth,
    device,
    organicResults: organic,
    paa: (data.related_questions ?? [])
      .map((q) => q.question?.trim())
      .filter((q): q is string => !!q),
    relatedSearches: (data.related_searches ?? [])
      .map((s) => s.query?.trim())
      .filter((q): q is string => !!q),
    serpFeatures: features,
    totalResults: data.search_information?.total_results ?? null,
    provider: "serpapi",
    retrievedAt: new Date().toISOString(),
    fromCache,
    estimatedCost: 0,
  };
}

function isSerpApiQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("quota") || msg.includes("429");
}
