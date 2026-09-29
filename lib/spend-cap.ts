/** Default daily DataForSEO ceiling when the env var is missing or invalid. */
export const DEFAULT_DAILY_CAP_USD = 25;

export function parseDailyCapUsd(raw: string | undefined): number {
  const n = Number(raw ?? String(DEFAULT_DAILY_CAP_USD));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP_USD;
}

export function spendWouldExceed(
  usedUsd: number,
  extraCost: number,
  capUsd: number,
): boolean {
  return usedUsd + extraCost >= capUsd;
}
