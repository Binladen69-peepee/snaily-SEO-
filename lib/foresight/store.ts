/**
 * Saving a forecast, and later finding out whether it was any good.
 *
 * The comparison is the part that earns the whole feature its keep. A forecast
 * nobody checks is a story; a forecast checked against Search Console three
 * months later is evidence, and after a few rounds of it the confidence figure
 * on the dashboard stops being decoration and starts being measured.
 *
 * Actuals are written into their own table rather than back onto the forecast
 * row. Nothing should ever be able to edit a prediction after the fact.
 */

import { prisma } from "@/lib/db";
import { toMonthKey } from "@/lib/foresight/trend";
import type { Forecast } from "@/lib/foresight/types";

export type SavedForecastSummary = {
  id: string;
  name: string;
  scenario: string;
  horizonMonths: number;
  modelVersion: string;
  dataCutoff: string | null;
  baselineClicks: number;
  forecastClicks: number;
  incrementalClicks: number;
  confidence: number | null;
  createdAt: string;
  /** Filled once actuals have been recorded against it. */
  comparison: {
    monthsCompared: number;
    predicted: number;
    actual: number;
    variancePercent: number;
  } | null;
};

export async function saveForecast(input: {
  userId: string;
  projectId: string;
  name: string;
  forecast: Forecast;
}): Promise<string> {
  const { forecast } = input;

  const saved = await prisma.foresightForecast.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      name: input.name.trim().slice(0, 120),
      scenario: forecast.assumptions.scenario,
      horizonMonths: forecast.assumptions.horizonMonths,
      modelVersion: forecast.modelVersion,
      assumptionVersion: forecast.assumptionVersion,
      dataCutoff:
        forecast.dataCutoff === null ? null : new Date(`${forecast.dataCutoff}T00:00:00Z`),
      assumptions: forecast.assumptions,
      dataSources: forecast.dataSources,
      readiness: {
        score: forecast.readiness.score,
        checks: forecast.readiness.checks,
        limitation: forecast.readiness.limitation,
      },
      baselineClicks: forecast.totals.baselineHorizonClicks.value ?? 0,
      forecastClicks: forecast.totals.forecastHorizonClicks.value ?? 0,
      incrementalClicks: forecast.totals.incrementalClicks.value ?? 0,
      confidence: forecast.confidence?.score ?? null,
      months: forecast.months.map((m, i) => ({
        ...m,
        p10: forecast.uncertainty.band.p10[i] ?? null,
        p90: forecast.uncertainty.band.p90[i] ?? null,
      })),
      plan: forecast.plan,
      projections: {
        create: forecast.keywords.slice(0, 200).map((k) => ({
          keyword: k.keyword,
          page: k.page ?? "",
          currentPosition: k.currentPosition.value,
          targetPosition: k.targetPosition,
          expectedPosition: k.expectedPosition.value ?? k.targetPosition,
          reachability: k.reachability.band,
          achievement: k.reachability.achievement,
          demand: k.demand.value === null ? null : Math.round(k.demand.value),
          demandSource: k.demand.provenance,
          currentClicks: k.currentClicks.value,
          forecastClicks: k.forecastClicks.value,
          incrementalClicks: k.incrementalClicks.value,
          expectedDays: k.timeToRank?.expectedDays ?? null,
          confidence: k.confidence,
        })),
      },
    },
    select: { id: true },
  });

  return saved.id;
}

export async function listForecasts(
  userId: string,
  projectId: string,
): Promise<SavedForecastSummary[]> {
  const rows = await prisma.foresightForecast.findMany({
    where: { userId, projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      scenario: true,
      horizonMonths: true,
      modelVersion: true,
      dataCutoff: true,
      baselineClicks: true,
      forecastClicks: true,
      incrementalClicks: true,
      confidence: true,
      createdAt: true,
      actuals: {
        select: { predictedClicks: true, actualClicks: true },
      },
    },
  });

  return rows.map((r) => {
    const predicted = r.actuals.reduce((s, a) => s + a.predictedClicks, 0);
    const actual = r.actuals.reduce((s, a) => s + a.actualClicks, 0);

    return {
      id: r.id,
      name: r.name,
      scenario: r.scenario,
      horizonMonths: r.horizonMonths,
      modelVersion: r.modelVersion,
      dataCutoff: r.dataCutoff?.toISOString().slice(0, 10) ?? null,
      baselineClicks: r.baselineClicks,
      forecastClicks: r.forecastClicks,
      incrementalClicks: r.incrementalClicks,
      confidence: r.confidence,
      createdAt: r.createdAt.toISOString(),
      comparison:
        r.actuals.length === 0
          ? null
          : {
              monthsCompared: r.actuals.length,
              predicted,
              actual,
              variancePercent:
                predicted === 0 ? 0 : Math.round(((actual - predicted) / predicted) * 1000) / 10,
            },
    };
  });
}

type SavedMonth = { month: string; baseline: number; expected: number };

function savedMonths(value: unknown): SavedMonth[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is SavedMonth =>
      m !== null &&
      typeof m === "object" &&
      typeof (m as SavedMonth).month === "string" &&
      typeof (m as SavedMonth).expected === "number",
  );
}

export type ComparisonRow = {
  month: string;
  predicted: number;
  actual: number;
  variancePercent: number;
};

/**
 * Scores a saved forecast against what Search Console has since recorded.
 *
 * Only months that have completely elapsed are compared. Scoring a month that
 * is four days old against a full month's forecast produces a catastrophic
 * variance and teaches nothing, and it is exactly the kind of number that gets
 * screenshotted.
 */
export async function compareToActual(
  userId: string,
  forecastId: string,
): Promise<{ rows: ComparisonRow[]; note: string }> {
  const forecast = await prisma.foresightForecast.findFirst({
    where: { id: forecastId, userId },
    select: { id: true, projectId: true, months: true },
  });

  if (forecast === null) return { rows: [], note: "Forecast not found." };

  const months = savedMonths(forecast.months);
  if (months.length === 0) {
    return { rows: [], note: "This forecast has no monthly projection to compare." };
  }

  const daily = await prisma.gscPageMetric.groupBy({
    by: ["date"],
    where: { projectId: forecast.projectId },
    _sum: { clicks: true },
  });

  if (daily.length === 0) {
    return {
      rows: [],
      note: "No Search Console data has been synced for this project, so there is nothing to compare against.",
    };
  }

  const actualByMonth = new Map<string, number>();
  const daysByMonth = new Map<string, number>();
  for (const d of daily) {
    const key = toMonthKey(d.date);
    actualByMonth.set(key, (actualByMonth.get(key) ?? 0) + (d._sum.clicks ?? 0));
    daysByMonth.set(key, (daysByMonth.get(key) ?? 0) + 1);
  }

  const now = new Date();
  const currentMonth = toMonthKey(now);

  const rows: ComparisonRow[] = [];
  for (const m of months) {
    if (m.month >= currentMonth) continue;
    const actual = actualByMonth.get(m.month);
    if (actual === undefined) continue;

    // A month with only a handful of synced days is not a complete month.
    const daysSeen = daysByMonth.get(m.month) ?? 0;
    const daysInMonth = new Date(
      new Date(`${m.month}T00:00:00Z`).getUTCFullYear(),
      new Date(`${m.month}T00:00:00Z`).getUTCMonth() + 1,
      0,
    ).getUTCDate();
    if (daysSeen < daysInMonth - 3) continue;

    rows.push({
      month: m.month,
      predicted: m.expected,
      actual,
      variancePercent:
        m.expected === 0 ? 0 : Math.round(((actual - m.expected) / m.expected) * 1000) / 10,
    });
  }

  if (rows.length === 0) {
    return {
      rows: [],
      note: "None of the forecast months have completely elapsed with full data yet. The comparison appears once they have.",
    };
  }

  await prisma.$transaction(
    rows.map((r) =>
      prisma.foresightActual.upsert({
        where: {
          forecastId_month: {
            forecastId: forecast.id,
            month: new Date(`${r.month}T00:00:00Z`),
          },
        },
        create: {
          forecastId: forecast.id,
          month: new Date(`${r.month}T00:00:00Z`),
          predictedClicks: r.predicted,
          actualClicks: r.actual,
          variancePercent: r.variancePercent,
        },
        update: {
          actualClicks: r.actual,
          variancePercent: r.variancePercent,
        },
      }),
    ),
  );

  return {
    rows,
    note: `${String(rows.length)} complete month${rows.length === 1 ? "" : "s"} compared against Search Console.`,
  };
}

export async function deleteForecast(userId: string, id: string): Promise<boolean> {
  const res = await prisma.foresightForecast.deleteMany({ where: { id, userId } });
  return res.count === 1;
}
