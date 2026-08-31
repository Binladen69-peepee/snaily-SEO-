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
import type { DataForSeoCredentials } from "@/lib/dataforseo/config";

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

export type DataForSeoPageSummary = {
  target: string;
  url: string;
  rank: number | null;
  mainDomainRank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringMainDomains: number | null;
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

type PageSummaryItem = {
  url?: string;
  rank?: number | null;
  main_domain_rank?: number | null;
  backlinks?: number | null;
  referring_domains?: number | null;
  referring_main_domains?: number | null;
  backlinks_spam_score?: number | null;
  spam_score?: number | null;
};

type PageSummaryBlock = {
  items_count?: number;
  items?: PageSummaryItem[];
};

/**
 * Bulk domain/page ranks on the 0–100 scale.
 * Cost-efficient for Keyword Research competitor columns.
 */
export async function fetchBulkRanks(
  targets: string[],
  opts: { fetchImpl?: typeof fetch; credentials?: DataForSeoCredentials } = {},
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
    { fetchImpl: opts.fetchImpl, credentials: opts.credentials },
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
  opts: { fetchImpl?: typeof fetch; credentials?: DataForSeoCredentials } = {},
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
    { fetchImpl: opts.fetchImpl, credentials: opts.credentials },
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

/**
 * Page/domain backlink summaries in one call (up to 1000 targets, 100 domains).
 * Used by Keyword Research for referring domains, backlinks and spam score.
 */
export async function fetchBulkPagesSummary(
  targets: string[],
  opts: { fetchImpl?: typeof fetch; credentials?: DataForSeoCredentials } = {},
): Promise<{ rows: DataForSeoPageSummary[]; cost: number }> {
  const cleaned = uniquePageTargets(targets);
  if (cleaned.length === 0) {
    return { rows: [], cost: 0 };
  }

  const response = await dataForSeoPost<PageSummaryBlock>(
    "/v3/backlinks/bulk_pages_summary/live",
    [
      {
        targets: cleaned,
        include_subdomains: true,
        rank_scale: "one_hundred",
      },
    ],
    { fetchImpl: opts.fetchImpl, credentials: opts.credentials },
  );

  const byTarget = new Map<string, DataForSeoPageSummary>();
  for (const block of response.result) {
    const items: PageSummaryItem[] = Array.isArray(block.items)
      ? block.items
      : [];
    for (const item of items) {
      const url = String(item.url ?? "").trim();
      if (url === "") continue;
      const row: DataForSeoPageSummary = {
        target: url,
        url,
        rank: clampRank(item.rank),
        mainDomainRank: clampRank(item.main_domain_rank),
        backlinks: nonNegInt(item.backlinks),
        referringDomains: nonNegInt(item.referring_domains),
        referringMainDomains: nonNegInt(item.referring_main_domains),
        spamScore: clampRank(item.backlinks_spam_score ?? item.spam_score),
      };
      byTarget.set(normalizePageTarget(url), row);
      byTarget.set(url, row);
    }
  }

  const rows: DataForSeoPageSummary[] = cleaned.map((target) => {
    const found =
      byTarget.get(normalizePageTarget(target)) ?? byTarget.get(target);
    return (
      found ?? {
        target,
        url: target,
        rank: null,
        mainDomainRank: null,
        backlinks: null,
        referringDomains: null,
        referringMainDomains: null,
        spamScore: null,
      }
    );
  });

  return { rows, cost: response.cost };
}

export function normalizePageTarget(raw: string): string {
  const value = raw.trim();
  if (value === "") return "";
  try {
    if (value.includes("://")) {
      const u = new URL(value);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      const path = u.pathname.replace(/\/+$/, "");
      return `${u.protocol}//${host}${path === "/" ? "" : path}`;
    }
  } catch {
    // keep
  }
  return normalizeTarget(value);
}

function uniquePageTargets(targets: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of targets) {
    const n = t.trim();
    if (n === "" || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.slice(0, 1000);
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
