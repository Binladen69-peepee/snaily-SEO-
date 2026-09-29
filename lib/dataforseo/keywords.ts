/**
 * DataForSEO Keywords Data + Labs — real volume, CPC, competition, KD.
 *
 * One Labs overview call covers a batch. Google Ads search_volume is the
 * fallback when Labs is unavailable on the account. Results are cached per
 * keyword for a week so a search does not re-bill the same phrases.
 */

import { dataForSeoPost } from "@/lib/dataforseo/client";
import { dataForSeoConfigured } from "@/lib/dataforseo/config";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "@/lib/dataforseo/locations";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";

export const KW_CACHE_ENGINE = "dfs_kw";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 40;

export type LiveKeywordMetrics = {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  trend: number[] | null;
  results: number | null;
};

type OverviewRow = {
  keyword?: string;
  keyword_info?: {
    search_volume?: number | null;
    cpc?: number | null;
    competition?: number | null;
    competition_index?: number | null;
    monthly_searches?: Array<{ search_volume?: number | null }>;
  } | null;
  keyword_properties?: {
    keyword_difficulty?: number | null;
  } | null;
  search_volume?: number | null;
  cpc?: number | null;
  competition?: number | string | null;
  competition_index?: number | null;
  keyword_difficulty?: number | null;
  monthly_searches?: Array<{ search_volume?: number | null }>;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function competition01(row: OverviewRow): number | null {
  const info = row.keyword_info;
  const direct = num(info?.competition) ?? num(row.competition);
  if (direct !== null) return Math.max(0, Math.min(1, direct));
  const index = num(info?.competition_index) ?? num(row.competition_index);
  if (index !== null) return Math.max(0, Math.min(1, index / 100));
  return null;
}

function trendFrom(row: OverviewRow): number[] | null {
  const months =
    row.keyword_info?.monthly_searches ?? row.monthly_searches ?? null;
  if (!Array.isArray(months) || months.length === 0) return null;
  const vols = months
    .map((m) => num(m?.search_volume) ?? 0)
    .slice(-12);
  if (vols.length === 0) return null;
  while (vols.length < 12) vols.unshift(vols[0] ?? 0);
  return vols.slice(-12);
}

function parseRow(raw: OverviewRow): LiveKeywordMetrics | null {
  const keyword = (raw.keyword ?? "").trim().toLowerCase();
  if (keyword === "") return null;
  const info = raw.keyword_info;
  return {
    keyword,
    searchVolume: num(info?.search_volume) ?? num(raw.search_volume),
    cpc: num(info?.cpc) ?? num(raw.cpc),
    competition: competition01(raw),
    difficulty:
      num(raw.keyword_properties?.keyword_difficulty) ??
      num(raw.keyword_difficulty),
    trend: trendFrom(raw),
    results: null,
  };
}

async function readCache(
  keywords: string[],
  country: string,
): Promise<Map<string, LiveKeywordMetrics>> {
  const out = new Map<string, LiveKeywordMetrics>();
  if (keywords.length === 0) return out;
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);
  try {
    const rows = await prisma.serpCache.findMany({
      where: {
        engine: KW_CACHE_ENGINE,
        country,
        query: { in: keywords },
        fetchedAt: { gte: cutoff },
      },
    });
    for (const row of rows) {
      const payload = row.payload as LiveKeywordMetrics;
      if (payload && typeof payload.keyword === "string") {
        out.set(payload.keyword, payload);
      }
    }
  } catch {
    /* cache miss is fine */
  }
  return out;
}

async function writeCache(
  country: string,
  rows: LiveKeywordMetrics[],
): Promise<void> {
  await Promise.all(
    rows.map((payload) =>
      prisma.serpCache
        .upsert({
          where: {
            engine_query_country: {
              engine: KW_CACHE_ENGINE,
              query: payload.keyword,
              country,
            },
          },
          create: {
            engine: KW_CACHE_ENGINE,
            query: payload.keyword,
            country,
            payload,
          },
          update: { payload, fetchedAt: new Date() },
        })
        .catch(() => undefined),
    ),
  );
}

async function fetchOverviewBatch(
  keywords: string[],
  country: string,
  language: string,
): Promise<LiveKeywordMetrics[]> {
  const locationCode = dataForSeoLocationCode(country);
  const languageCode = dataForSeoLanguageCode(language);

  try {
    const response = await dataForSeoPost<OverviewRow>(
      "/v3/dataforseo_labs/google/keyword_overview/live",
      [
        {
          keywords,
          location_code: locationCode,
          language_code: languageCode,
        },
      ],
      { timeoutMs: 25_000 },
    );
    return response.result.map(parseRow).filter((r): r is LiveKeywordMetrics => r !== null);
  } catch (err) {
    log("dfs.kw.overview_fail", {
      count: keywords.length,
      error: err instanceof Error ? err.message : "unknown",
    });
  }

  try {
    const response = await dataForSeoPost<OverviewRow>(
      "/v3/keywords_data/google_ads/search_volume/live",
      [
        {
          keywords,
          location_code: locationCode,
          language_code: languageCode,
        },
      ],
      { timeoutMs: 25_000 },
    );
    return response.result.map(parseRow).filter((r): r is LiveKeywordMetrics => r !== null);
  } catch (err) {
    log("dfs.kw.volume_fail", {
      count: keywords.length,
      error: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
}

/**
 * Live metrics for many phrases. Always returns a map — missing keys were
 * not in the provider response and the caller should fill from estimates.
 */
export async function fetchKeywordMetricsMany(
  keywords: string[],
  country: string,
  language = "en",
): Promise<Map<string, LiveKeywordMetrics>> {
  const unique = [
    ...new Set(keywords.map((k) => k.trim().toLowerCase()).filter((k) => k !== "")),
  ];
  const out = new Map<string, LiveKeywordMetrics>();
  if (unique.length === 0 || !dataForSeoConfigured()) return out;

  const cached = await readCache(unique, country);
  for (const [k, v] of cached) out.set(k, v);

  const missing = unique.filter((k) => !out.has(k)).slice(0, 80);
  if (missing.length === 0) return out;

  const fresh: LiveKeywordMetrics[] = [];
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const rows = await fetchOverviewBatch(chunk, country, language);
    fresh.push(...rows);
    for (const row of rows) out.set(row.keyword, row);
  }

  if (fresh.length > 0) {
    await writeCache(country, fresh);
    log("dfs.kw.hydrated", { requested: missing.length, live: fresh.length, country });
  }

  return out;
}
