/**
 * DataForSEO backlinks / rank types and endpoint helpers.
 *
 * Primary authority signal: Backlinks API `rank` on the 0–100 scale
 * (`rank_scale: one_hundred`). This is DataForSEO Rank — NOT Moz DA/PA.
 *
 * Docs:
 * - POST /v3/backlinks/bulk_ranks/live
 * - POST /v3/backlinks/bulk_spam_score/live (optional)
 * - POST /v3/backlinks/summary/live
 */
import { dataForSeoPost } from "../../lib/dataforseo/client.js";
import { DataForSeoError } from "../../lib/dataforseo/errors.js";
export const DATAFORSEO_PROVIDER = "dataforseo";
export const DATAFORSEO_RANK_METRIC = "rank_0_100";
export const DATAFORSEO_RANK_LABEL = "DataForSEO Rank";
/**
 * Bulk domain/page ranks on the 0–100 scale.
 * Cost-efficient for Keyword Research competitor columns.
 */
export async function fetchBulkRanks(targets, opts = {}) {
    const cleaned = uniqueTargets(targets);
    if (cleaned.length === 0) {
        return { rows: [], cost: 0 };
    }
    /*
     * bulk_ranks nests its rows: result[0].items[], not result[] like the other
     * endpoints. Reading result[] directly found no `target` on the single
     * wrapper object, so every rank came back null while DataForSEO still billed
     * for the call — which is why every domain fell through to the Snaily
     * heuristic and the authority ordering looked wrong.
     */
    const response = await dataForSeoPost("/v3/backlinks/bulk_ranks/live", [
        {
            targets: cleaned,
            rank_scale: "one_hundred",
        },
    ], { fetchImpl: opts.fetchImpl });
    const byTarget = new Map();
    for (const block of response.result) {
        // Tolerate both shapes: a nested items[] and a flat row.
        const items = Array.isArray(block.items)
            ? block.items
            : [block];
        for (const item of items) {
            const target = normalizeTarget(String(item.target ?? ""));
            if (target === "")
                continue;
            byTarget.set(target, clampRank(item.rank));
        }
    }
    const rows = cleaned.map((target) => ({
        target,
        rank: byTarget.get(target) ?? null,
    }));
    return { rows, cost: response.cost };
}
/**
 * Full backlink summary for a single domain or URL.
 * Prefer bulk_ranks for multi-domain SERP enrichment; use this when we need
 * referring_domains / backlinks counts for one domain.
 */
export async function fetchBacklinkSummary(target, opts = {}) {
    const cleaned = normalizeTarget(target);
    if (cleaned === "") {
        throw new DataForSeoError("bad_request", "DataForSEO target domain is empty.");
    }
    const response = await dataForSeoPost("/v3/backlinks/summary/live", [
        {
            target: cleaned,
            include_subdomains: true,
            exclude_internal_backlinks: true,
            rank_scale: "one_hundred",
        },
    ], { fetchImpl: opts.fetchImpl });
    const item = response.result[0];
    if (!item) {
        throw new DataForSeoError("empty", "DataForSEO returned an empty backlink summary.");
    }
    return {
        cost: response.cost,
        summary: {
            target: cleaned,
            rank: clampRank(item.rank),
            backlinks: nonNegInt(item.backlinks),
            referringDomains: nonNegInt(item.referring_domains),
            referringMainDomains: nonNegInt(item.referring_main_domains),
            referringPages: nonNegInt(item.referring_pages),
            spamScore: clampRank(item.backlinks_spam_score ?? item.spam_score),
        },
    };
}
export function normalizeTarget(raw) {
    let value = raw.trim().toLowerCase();
    if (value === "")
        return "";
    try {
        if (value.includes("://")) {
            value = new URL(value).hostname;
        }
        else if (value.includes("/")) {
            value = value.split("/")[0] ?? value;
        }
    }
    catch {
        // keep raw host-ish string
    }
    value = value.replace(/^www\./, "");
    return value.replace(/\.+$/, "");
}
function uniqueTargets(targets) {
    const seen = new Set();
    const out = [];
    for (const t of targets) {
        const n = normalizeTarget(t);
        if (n === "" || seen.has(n))
            continue;
        seen.add(n);
        out.push(n);
    }
    return out.slice(0, 1000);
}
function clampRank(value) {
    if (value === null || value === undefined)
        return null;
    const n = Number(value);
    if (!Number.isFinite(n))
        return null;
    return Math.max(0, Math.min(100, Math.round(n)));
}
function nonNegInt(value) {
    if (value === null || value === undefined)
        return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
        return null;
    return Math.round(n);
}
