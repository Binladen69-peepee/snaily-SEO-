/**
 * DataForSEO provider adapter.
 *
 * SERP: getNormalizedSerp() — Drafter prefers DataForSEO (preferProvider),
 * Keyword Research prefers SerpApi while quota remains, then DataForSEO.
 * Rank / backlinks / referring domains / spam score: DataForSEO Backlinks API.
 * Not Moz DA/PA.
 */

export {
  dataForSeoConfigured,
  readCredentials,
  requireCredentials,
  DataForSeoConfigError,
} from "@/lib/dataforseo/config";
export { DataForSeoError } from "@/lib/dataforseo/errors";
export { checkDataForSeoHealth, type DataForSeoHealth } from "@/lib/dataforseo/health";
export {
  DATAFORSEO_PROVIDER,
  DATAFORSEO_RANK_LABEL,
  DATAFORSEO_RANK_METRIC,
  fetchBacklinkSummary,
  fetchBulkPagesSummary,
  fetchBulkRanks,
  normalizeTarget,
} from "@/lib/dataforseo/backlinks";
export {
  getCachedBacklinkSummary,
  getCachedBulkPagesSummary,
  getCachedDataForSeoRanks,
  recentDataForSeoUsage,
} from "@/lib/dataforseo/cache";
export { fetchKeywordMetricsMany, type LiveKeywordMetrics } from "@/lib/dataforseo/keywords";

import { checkDataForSeoHealth } from "@/lib/dataforseo/health";
import {
  getCachedBacklinkSummary,
  getCachedBulkPagesSummary,
  getCachedDataForSeoRanks,
} from "@/lib/dataforseo/cache";
import { dataForSeoConfigured } from "@/lib/dataforseo/config";

export const DataForSeoProvider = {
  id: "dataforseo" as const,
  label: "DataForSEO",

  configured: dataForSeoConfigured,

  async authenticate() {
    return checkDataForSeoHealth();
  },

  async health() {
    return checkDataForSeoHealth();
  },

  async authority(domains: string[]) {
    return getCachedDataForSeoRanks(domains);
  },

  async backlinks(domain: string) {
    return getCachedBacklinkSummary(domain);
  },

  async pageSummaries(targets: string[]) {
    return getCachedBulkPagesSummary(targets);
  },
};
