import { prisma } from "@/lib/db";
import { DataForSeoError } from "@/lib/dataforseo/errors";
import { log } from "@/lib/log";
import { parseDailyCapUsd, spendWouldExceed } from "@/lib/spend-cap";

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function dailyCapUsd(): number {
  return parseDailyCapUsd(process.env.DATAFORSEO_DAILY_CAP_USD);
}

export async function assertProviderSpend(
  provider: string,
  extraCost = 0,
): Promise<void> {
  const day = utcDay();
  const cap = dailyCapUsd();
  try {
    const row = await prisma.providerSpend.findUnique({
      where: { provider_day: { provider, day } },
    });
    const used = row?.costUsd ?? 0;
    if (spendWouldExceed(used, extraCost, cap)) {
      log("provider.cap", { provider, day, used: used + extraCost, cap });
      throw new DataForSeoError(
        "insufficient_balance",
        `Daily ${provider} spend cap ($${cap.toFixed(2)}) reached. Try again tomorrow.`,
      );
    }
  } catch (err) {
    if (err instanceof DataForSeoError) throw err;
    /* Table may not exist yet — do not block the product. */
  }
}

export async function recordProviderSpend(
  provider: string,
  costUsd: number,
  calls = 1,
): Promise<void> {
  const day = utcDay();
  const cost = Number.isFinite(costUsd) ? Math.max(0, costUsd) : 0;
  try {
    await prisma.providerSpend.upsert({
      where: { provider_day: { provider, day } },
      create: { provider, day, costUsd: cost, calls },
      update: { costUsd: { increment: cost }, calls: { increment: calls } },
    });
  } catch {
    /* ignore */
  }
}
