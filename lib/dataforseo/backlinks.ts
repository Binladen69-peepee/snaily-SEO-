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

import { dataForSeoPost } from "@/lib/dataforseo/client";
import { DataForSeoError } from "@/lib/dataforseo/errors";

export const DATAFORSEO_PROVIDER = "dataforseo" as const;
export const DATAFORSEO_RANK_METRIC = "rank_0_100" as const;
export const DATAFORSEO_RANK_LABEL = "DataForSEO Rank";

export type DataForSeoRankRow = {
  target: string;
  rank: number | null;
};

export type DataForSeoBacklinkSummary = {
  target: string;
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringMainDomains: number | null;
  referringPages: number | null;
  spamScore: number | null;
};

type BulkRankItem = {
  target?: string;
  rank?: number | null;
};

/** bulk_ranks wraps its rows in a single result block. */
type BulkRankBlock = {
  items_count?: number;
  items?: BulkRankItem[];
  target?: string;
  rank?: number | null;
};

type SummaryItem = {
  target?: string;
  rank?: number | null;
  backlinks?: number | null;
  referring_domains?: number | null;
  referring_main_domains?: number | null;
  referring_pages?: number | null;
  spam_score?: number | null;
  /** The name the live API actually uses. */
  backlinks_spam_score?: number | null;
};

/**
 * Bulk domain/page ranks on the 0–100 scale.
 * Cost-efficient for Keyword Research competitor columns.
 */
export async function fetchBulkRanks(
  targets: string[],
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ rows: DataForSeoRankRow[]; cost: number }> {
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
  const response = await dataForSeoPost<BulkRankBlock>(
    "/v3/backlinks/bulk_ranks/live",
    [
      {
        targets: cleaned,
        rank_scale: "one_hundred",
      },
    ],
    { fetchImpl: opts.fetchImpl },
  );

  const byTarget = new Map<string, number | null>();
  for (const block of response.result) {
    // Tolerate both shapes: a nested items[] and a flat row.
    const items: BulkRankItem[] = Array.isArray(block.items)
      ? block.items
      : [block as BulkRankItem];
    for (const item of items) {
      const target = normalizeTarget(String(item.target ?? ""));
      if (target === "") continue;
      byTarget.set(target, clampRank(item.rank));
    }
  }

  const rows: DataForSeoRankRow[] = cleaned.map((target) => ({
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
export async function fetchBacklinkSummary(
  target: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ summary: DataForSeoBacklinkSummary; cost: number }> {
  const cleaned = normalizeTarget(target);
  if (cleaned === "") {
    throw new DataForSeoError("bad_request", "DataForSEO target domain is empty.");
  }

  const response = await dataForSeoPost<SummaryItem>(
    "/v3/backlinks/summary/live",
    [
      {
        target: cleaned,
        include_subdomains: true,
        exclude_internal_backlinks: true,
        rank_scale: "one_hundred",
      },
    ],
    { fetchImpl: opts.fetchImpl },
  );

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

export function normalizeTarget(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (value === "") return "";
  try {
    if (value.includes("://")) {
      value = new URL(value).hostname;
    } else if (value.includes("/")) {
      value = value.split("/")[0] ?? value;
    }
  } catch {
    // keep raw host-ish string
  }
  value = value.replace(/^www\./, "");
  return value.replace(/\.+$/, "");
}

function uniqueTargets(targets: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of targets) {
    const n = normalizeTarget(t);
    if (n === "" || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.slice(0, 1000);
}

function clampRank(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function nonNegInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}
