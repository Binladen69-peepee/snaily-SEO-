/**
 * SerpApi quota circuit breaker.
 *
 * When monthly quota is exhausted (429 or account left === 0), skip SerpApi
 * for a cool-down window so exhausted quota cannot hammer the product.
 */

import { serpSearchesLeft } from "@/lib/keywords/quota";
import { ensureSettings } from "@/lib/settings";

let exhaustedUntil = 0;

export function markSerpApiQuotaExhausted(ttlMs = 60 * 60 * 1000): void {
  exhaustedUntil = Date.now() + ttlMs;
}

export function clearSerpApiQuotaExhaustion(): void {
  exhaustedUntil = 0;
}

export function serpApiQuotaBlocked(): boolean {
  return Date.now() < exhaustedUntil;
}

export function serpApiConfigured(): boolean {
  return (process.env.SERPAPI_KEY ?? "").trim() !== "";
}

/**
 * True when SerpApi may be used as a fallback (key present, not circuit-broken,
 * and account still has searches when we can tell).
 */
export async function serpApiFallbackAvailable(): Promise<boolean> {
  // The key may live in the encrypted settings store rather than the
  // environment; hydrate before deciding the provider is unconfigured.
  await ensureSettings();
  if (!serpApiConfigured()) return false;
  if (serpApiQuotaBlocked()) return false;

  const quota = await serpSearchesLeft().catch(() => ({
    left: null as number | null,
    total: null as number | null,
  }));
  if (quota.left !== null && quota.left <= 0) {
    markSerpApiQuotaExhausted();
    return false;
  }
  return true;
}
