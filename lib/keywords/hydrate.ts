/**
 * Fill keyword metric fields so the UI never renders an empty cell.
 *
 * Live DataForSEO values win. Anything the API does not know is filled from
 * the deterministic estimate so volume/CPC/KD/trend are always numbers.
 */

import { fetchKeywordMetricsMany } from "@/lib/dataforseo/keywords";
import { applyLiveMetrics } from "@/lib/keywords/apply-live-metrics";
import { estimateKeyword } from "@/lib/keywords/estimate";
import type { Keyword } from "@/lib/keywords/types";

export { applyLiveMetrics } from "@/lib/keywords/apply-live-metrics";

export async function hydrateKeywords(
  phrases: string[],
  country: string,
  language = "en",
): Promise<Keyword[]> {
  const unique = [
    ...new Set(
      phrases.map((p) => p.trim().toLowerCase()).filter((p) => p !== ""),
    ),
  ];
  if (unique.length === 0) return [];

  const live = await fetchKeywordMetricsMany(unique, country, language);

  return unique.map((phrase) =>
    applyLiveMetrics(estimateKeyword(phrase, country), live.get(phrase)),
  );
}

export async function hydrateKeyword(
  phrase: string,
  country: string,
  language = "en",
): Promise<Keyword> {
  const [row] = await hydrateKeywords([phrase], country, language);
  return row ?? { ...estimateKeyword(phrase, country), metricsSource: "estimated" };
}

export function keywordMap(rows: Keyword[]): Map<string, Keyword> {
  return new Map(rows.map((r) => [r.keyword, r]));
}
