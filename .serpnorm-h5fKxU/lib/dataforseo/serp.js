/**
 * DataForSEO Google Organic SERP (Live Advanced) + Autocomplete.
 *
 * Endpoint: POST /v3/serp/google/organic/live/advanced
 * Autocomplete: POST /v3/serp/google/autocomplete/live/advanced
 *
 * Item types consumed: organic, people_also_ask, related_searches,
 * plus feature flags from item_types / top-level types.
 */
import { dataForSeoPost } from "../../lib/dataforseo/client.js";
import { dataForSeoLanguageCode, dataForSeoLocationCode, } from "../../lib/dataforseo/locations.js";
/**
 * How long to wait for a live SERP, scaled to the depth requested.
 *
 * DataForSEO builds a live SERP page by page, so time grows with depth:
 * measured against the live account, depth 10 returns in ~2s, depth 50 in
 * ~18s and depth 100 in ~40s. A flat 45s left the rank tracker's depth-100
 * calls timing out on a slow run, which is the one case that most needs the
 * deep result.
 */
function serpTimeoutMs(depth) {
    return Math.min(120_000, 30_000 + depth * 700);
}
/**
 * Live Google organic SERP with PAA + related searches.
 * Cost scales with depth — callers must pass only what they need.
 */
export async function fetchDataForSeoOrganicSerp(opts) {
    const depth = Math.min(100, Math.max(1, opts.depth ?? 10));
    const language = dataForSeoLanguageCode(opts.language ?? "en");
    const locationCode = dataForSeoLocationCode(opts.country);
    const response = await dataForSeoPost("/v3/serp/google/organic/live/advanced", [
        {
            keyword: opts.keyword,
            location_code: locationCode,
            language_code: language,
            device: opts.device ?? "desktop",
            depth,
            // Keep cost down — no paid PAA click expansion / AI overview extras.
        },
    ], { fetchImpl: opts.fetchImpl, timeoutMs: serpTimeoutMs(depth) });
    const block = response.result[0];
    return {
        ...parseDfsSerpBlock(block),
        cost: response.cost,
    };
}
export function parseDfsSerpBlock(block) {
    const items = block?.items ?? [];
    const organic = [];
    const paa = [];
    const relatedSearches = [];
    const features = new Set(block?.item_types ?? []);
    for (const item of items) {
        const type = String(item.type ?? "");
        if (type)
            features.add(type);
        if (type === "organic") {
            const url = String(item.url ?? "");
            const domain = String(item.domain ?? "").replace(/^www\./, "") || hostOf(url);
            organic.push({
                position: Number(item.rank_group ?? item.rank_absolute ?? organic.length + 1),
                title: String(item.title ?? url),
                url,
                domain,
                snippet: String(item.description ?? ""),
                breadcrumb: String(item.breadcrumb ?? ""),
                websiteName: String(item.website_name ?? domain),
                sitelinks: Array.isArray(item.links) ? item.links.length : 0,
                rating: typeof item.rating?.value === "number" ? item.rating.value : null,
                reviews: typeof item.rating?.votes_count === "number"
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
                    if (q)
                        paa.push(q);
                    continue;
                }
                const q = String(child.title ?? child.question ?? "").trim();
                if (q)
                    paa.push(q);
            }
            continue;
        }
        if (type === "related_searches") {
            for (const child of item.items ?? []) {
                if (typeof child === "string") {
                    const q = child.trim();
                    if (q)
                        relatedSearches.push(q);
                    continue;
                }
                const q = String(child.title ?? "").trim();
                if (q)
                    relatedSearches.push(q);
            }
        }
    }
    return {
        organic,
        paa: unique(paa).slice(0, 20),
        relatedSearches: unique(relatedSearches).slice(0, 20),
        serpFeatures: [...features],
        totalResults: typeof block?.se_results_count === "number" ? block.se_results_count : null,
    };
}
export async function fetchDataForSeoAutocomplete(keyword, country, opts = {}) {
    const response = await dataForSeoPost("/v3/serp/google/autocomplete/live/advanced", [
        {
            keyword,
            location_code: dataForSeoLocationCode(country),
            language_code: dataForSeoLanguageCode(opts.language ?? "en"),
        },
    ], { fetchImpl: opts.fetchImpl, timeoutMs: 20_000 });
    const suggestions = (response.result[0]?.items ?? [])
        .map((i) => String(i.suggestion ?? "").trim())
        .filter((s) => s !== "");
    return { suggestions: unique(suggestions), cost: response.cost };
}
function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    }
    catch {
        return "";
    }
}
function unique(values) {
    const seen = new Set();
    const out = [];
    for (const v of values) {
        const key = v.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(v);
    }
    return out;
}
