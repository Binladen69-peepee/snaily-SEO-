/**
 * DataForSEO provider adapter.
 *
 * SERP: getNormalizedSerp() — Drafter prefers DataForSEO (preferProvider),
 * Keyword Research prefers SerpApi while quota remains, then DataForSEO.
 * Authority: DataForSEO Rank via bulk_ranks / summary.
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
  fetchBulkRanks,
  normalizeTarget,
} from "@/lib/dataforseo/backlinks";
export {
  getCachedBacklinkSummary,
  getCachedDataForSeoRanks,
  recentDataForSeoUsage,
} from "@/lib/dataforseo/cache";

import { checkDataForSeoHealth } from "@/lib/dataforseo/health";
import {
  getCachedBacklinkSummary,
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
};
