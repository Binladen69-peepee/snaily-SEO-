import { prisma } from "@/lib/db";
import type { DeepDiveSource } from "@/lib/keywords/deep-dive-sources";

export {
  AUTO_ENRICH_CAP,
  isSource,
  SOURCE_BY_ID,
  SOURCES,
  SUGGEST_SOURCES,
  type DeepDiveSource,
  type SourceInfo,
} from "@/lib/keywords/deep-dive-sources";

/**
 * Where Deep Dive's keyword ideas come from.
 *
 * Each source is a real autocomplete endpoint, hit directly rather than through
 * a paid SERP provider. Responses are cached in `SerpCache` on the same 7-day
 * TTL as everything else, so re-running a search costs nothing.
 */

/* ---------------------------------------------------------------------------
 * Fetching
 * ------------------------------------------------------------------------ */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5_000;

/**
 * A desktop browser's user agent.
 *
 * These endpoints serve the sites' own search boxes and several return an empty
 * list, or HTML, to a default Node agent.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Country codes these endpoints understand, from the app's own list. */
function googleCountry(country: string): string {
  return country === "any" ? "us" : country === "uk" ? "uk" : country;
}

type Fetcher = (keyword: string, country: string) => Promise<string[]>;

/** The OpenSearch shape: `["query", ["suggestion", …]]`. Google, Bing, DDG, eBay. */
function openSearch(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  const list = payload[1];
  return Array.isArray(list)
    ? list.filter((v): v is string => typeof v === "string")
    : [];
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json, text/javascript, */*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  // Several of these send JSON under a text/javascript content type.
  return JSON.parse(await res.text()) as unknown;
}

const FETCHERS: Partial<Record<DeepDiveSource, Fetcher>> = {
  google: async (q, country) =>
    openSearch(
      await getJson(
        `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=${googleCountry(country)}&q=${encodeURIComponent(q)}`,
      ),
    ),

  youtube: async (q) =>
    openSearch(
      await getJson(
        `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=en&q=${encodeURIComponent(q)}`,
      ),
    ),

  bing: async (q) =>
    openSearch(
      await getJson(`https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`),
    ),

  duckduckgo: async (q) =>
    openSearch(
      await getJson(
        `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
      ),
    ),

  ebay: async (q) =>
    openSearch(
      await getJson(
        `https://autosug.ebay.com/autosug?kwd=${encodeURIComponent(q)}&sId=0&fmt=osr`,
      ),
    ),

  amazon: async (q) => {
    // Amazon's 2017 suggestions API. The older /search/complete path 404s now.
    const payload = (await getJson(
      `https://completion.amazon.com/api/2017/suggestions?mid=ATVPDKIKX0DER&alias=aps&prefix=${encodeURIComponent(q)}&limit=11`,
    )) as { suggestions?: { value?: unknown }[] };

    return (payload.suggestions ?? [])
      .map((s) => (typeof s.value === "string" ? s.value : ""))
      .filter((v) => v !== "");
  },
};

/**
 * Autocomplete phrases for one source, cached.
 *
 * Never throws: a source that is slow or blocked returns nothing and the search
 * reports which sources answered, rather than failing the whole page because
 * one endpoint had a bad minute.
 */
export async function fetchSuggestions(
  source: DeepDiveSource,
  keyword: string,
  country: string,
): Promise<string[]> {
  const fetcher = FETCHERS[source];
  if (!fetcher) return [];

  const key = {
    engine: `suggest_${source}`,
    query: keyword.trim().toLowerCase(),
    country,
  };

  const cached = await prisma.serpCache.findUnique({
    where: { engine_query_country: key },
  });

  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    const payload = cached.payload as { phrases?: unknown };
    return Array.isArray(payload.phrases)
      ? payload.phrases.filter((p): p is string => typeof p === "string")
      : [];
  }

  let phrases: string[];
  try {
    phrases = await fetcher(keyword, country);
  } catch {
    // Stale beats empty when the endpoint is having a moment.
    if (cached) {
      const payload = cached.payload as { phrases?: unknown };
      return Array.isArray(payload.phrases)
        ? payload.phrases.filter((p): p is string => typeof p === "string")
        : [];
    }
    return [];
  }

  const clean = [
    ...new Set(
      phrases
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p !== "" && p.length <= 120),
    ),
  ];

  await prisma.serpCache.upsert({
    where: { engine_query_country: key },
    create: { ...key, payload: { phrases: clean } },
    update: { payload: { phrases: clean }, fetchedAt: new Date() },
  });

  return clean;
}

/**
 * A wider net from one source: the seed, then the seed with each letter
 * appended.
 *
 * This is the trick that turns an 8-phrase autocomplete response into the few
 * hundred ideas the screen is for, and it is what KeySearch's own numbers imply
 * — no single autocomplete call returns 699 phrases. Each expansion is cached
 * independently, so a repeat search costs nothing at all.
 *
 * @param deadline — stop launching new batches after this timestamp so the
 *   Vercel function can return partial results instead of timing out.
 */
export async function expandSuggestions(
  source: DeepDiveSource,
  keyword: string,
  country: string,
  alphabet = "abcdefghijklmnopqrstuvwxyz",
  deadline?: number,
): Promise<string[]> {
  const seeds = [keyword, ...[...alphabet].map((c) => `${keyword} ${c}`)];

  const found = new Set<string>();
  const BATCH = 4;

  for (let i = 0; i < seeds.length; i += BATCH) {
    if (deadline && Date.now() > deadline) break;
    const batch = await Promise.all(
      seeds.slice(i, i + BATCH).map((seed) => fetchSuggestions(source, seed, country)),
    );
    for (const list of batch) for (const phrase of list) found.add(phrase);
  }

  return [...found];
}
