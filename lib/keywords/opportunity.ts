import type { Keyword } from "@/lib/keywords/types";

/**
 * Opportunity score, 0–100.
 *
 * Deliberately simple and explainable: high volume is good, high difficulty is
 * bad. Volume is scored on a log scale because the gap between 100 and 1,000
 * searches matters far more than the gap between 50,000 and 51,000.
 *
 * Shared so Content Audit can rank pages with the same logic later.
 */
export function opportunityScore(k: Keyword): number {
  // 10 searches → 0, 100,000 searches → 100
  const volumeScore = Math.min(
    100,
    Math.max(0, ((Math.log10(Math.max(k.volume, 1)) - 1) / 4) * 100),
  );
  const easeScore = 100 - k.difficulty;

  return Math.round(easeScore * 0.6 + volumeScore * 0.4);
}

export function opportunityBand(score: number): {
  label: string;
  className: string;
} {
  if (score >= 70) return { label: "High", className: "text-success" };
  if (score >= 45) return { label: "Medium", className: "text-warning" };
  return { label: "Low", className: "text-muted-foreground" };
}

export type BulkSummary = {
  total: number;
  avgVolume: number;
  avgDifficulty: number;
  totalVolume: number;
  best: (Keyword & { opportunity: number }) | null;
};

export function summarize(keywords: (Keyword & { opportunity: number })[]): BulkSummary {
  if (keywords.length === 0) {
    return {
      total: 0,
      avgVolume: 0,
      avgDifficulty: 0,
      totalVolume: 0,
      best: null,
    };
  }

  const totalVolume = keywords.reduce((sum, k) => sum + k.volume, 0);
  const totalDifficulty = keywords.reduce((sum, k) => sum + k.difficulty, 0);
  const best = keywords.reduce((a, b) => (b.opportunity > a.opportunity ? b : a));

  return {
    total: keywords.length,
    avgVolume: Math.round(totalVolume / keywords.length),
    avgDifficulty: Math.round(totalDifficulty / keywords.length),
    totalVolume,
    best,
  };
}

/** Splits pasted text on newlines or commas, trims, dedupes, drops blanks. */
export function parseKeywordInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of raw.split(/[\n,;]+/)) {
    const k = part.trim().replace(/\s+/g, " ").toLowerCase();
    if (k === "" || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }

  return out;
}

export const MAX_BULK_KEYWORDS = 500;
