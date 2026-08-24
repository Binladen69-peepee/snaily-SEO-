/**
 * Saving a forecast, and scoring it against reality, against the real database.
 *
 * The reproducibility claim is the one worth testing here: a forecast saved
 * today has to be explainable in six months, which means its assumptions and
 * model version have to survive the round trip intact. If they do not, the
 * comparison against actuals measures the difference between two models as
 * well as the difference between prediction and outcome, and nobody can
 * separate them afterwards.
 *
 *   node --env-file=.env scripts/test-foresight-db.mjs
 */
import { PrismaClient } from "@prisma/client";

import { checker, compile } from "./compile.mjs";

const built = compile(
  [
    "lib/db.ts",
    "lib/foresight/forecast.ts",
    "lib/foresight/scenario.ts",
    "lib/foresight/store.ts",
  ],
  { prefix: ".fsdbtest-" },
);

const Forecast = await built.load("lib/foresight/forecast.ts");
const Scenario = await built.load("lib/foresight/scenario.ts");
const Store = await built.load("lib/foresight/store.ts");

const prisma = new PrismaClient();
const t = checker();

const created = [];

try {
  const project = await prisma.project.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, userId: true, name: true },
  });
  if (project === null) throw new Error("No project to test against.");

  t.section("Determinism");

  const assumptions = Scenario.defaultAssumptions("expected", 6);
  const build = () =>
    Forecast.buildForecast({
      projectId: project.id,
      siteUrl: project.url,
      userId: project.userId,
      assumptions,
    });

  const [a, b] = [await build(), await build()];

  t.check(a.modelVersion === b.modelVersion, "the model version is stable");
  t.check(
    JSON.stringify(a.totals) === JSON.stringify(b.totals),
    "the same evidence and assumptions produce identical totals",
  );
  t.check(
    JSON.stringify(a.uncertainty.band) === JSON.stringify(b.uncertainty.band),
    "and an identical uncertainty band — a forecast must not drift on refresh",
  );
  t.check(
    JSON.stringify(a.opportunities.map((o) => o.id)) ===
      JSON.stringify(b.opportunities.map((o) => o.id)),
    "and the same opportunities in the same order",
  );

  t.section("Scenarios differ");

  const conservative = await Forecast.buildForecast({
    projectId: project.id,
    siteUrl: project.url,
    userId: project.userId,
    assumptions: Scenario.defaultAssumptions("conservative", 6),
  });
  const aggressive = await Forecast.buildForecast({
    projectId: project.id,
    siteUrl: project.url,
    userId: project.userId,
    assumptions: Scenario.defaultAssumptions("aggressive", 6),
  });

  t.check(
    conservative.assumptions.rankAchievement < aggressive.assumptions.rankAchievement,
    "the scenarios carry genuinely different assumptions",
  );
  t.check(
    conservative.assumptionNotes.length === aggressive.assumptionNotes.length,
    "and both explain the same set of levers",
  );

  const conservativeKeyword = conservative.keywords[0];
  const aggressiveKeyword = aggressive.keywords[0];
  if (conservativeKeyword !== undefined && aggressiveKeyword !== undefined) {
    t.check(
      (conservativeKeyword.expectedPosition.value ?? 0) >=
        (aggressiveKeyword.expectedPosition.value ?? 0),
      "and the conservative case expects a worse position than the aggressive one",
    );
  } else {
    t.check(true, "no keyword projections available to compare (no ranking data)");
  }

  t.section("Provenance survives");

  const everyFigure = [
    a.totals.currentMonthlyClicks,
    a.totals.baselineHorizonClicks,
    a.totals.forecastHorizonClicks,
    a.totals.incrementalClicks,
    a.totals.changePercent,
    ...a.keywords.flatMap((k) => [k.demand, k.currentClicks, k.forecastClicks, k.incrementalClicks]),
    ...a.opportunities.map((o) => o.impactClicks),
  ];

  t.check(
    everyFigure.every((f) => f.value === null || f.provenance !== "unavailable"),
    "a figure is unavailable exactly when it has no value",
  );
  t.check(
    everyFigure.every((f) => f.note.trim().length > 10),
    "and every figure explains itself, including the unavailable ones",
  );
  t.check(
    everyFigure.filter((f) => f.value === null).every((f) => f.provenance === "unavailable"),
    "nothing null is labelled as anything but unavailable",
  );
  t.check(
    a.dataSources.every((d) => d.provenance !== "modeled"),
    "no input source is described as modelled — sources are measured or missing",
  );

  t.section("Saving and reproducing");

  const id = await Store.saveForecast({
    userId: project.userId,
    projectId: project.id,
    name: "automated test",
    forecast: a,
  });
  created.push(id);

  const row = await prisma.foresightForecast.findUnique({
    where: { id },
    select: {
      modelVersion: true,
      assumptionVersion: true,
      assumptions: true,
      scenario: true,
      horizonMonths: true,
      confidence: true,
      dataSources: true,
      months: true,
      projections: { select: { keyword: true, demand: true, demandSource: true } },
    },
  });

  t.check(row.modelVersion === a.modelVersion, "the model version is stored");
  t.check(row.assumptionVersion === a.assumptionVersion, "and the assumption version");
  t.check(
    row.assumptions.rankAchievement === a.assumptions.rankAchievement,
    "the assumptions round-trip intact",
  );
  t.check(row.scenario === "expected" && row.horizonMonths === 6, "as do scenario and horizon");
  t.check(
    row.confidence === null,
    "confidence is stored as null rather than a decorative number, because no backtest has run",
  );
  t.check(Array.isArray(row.dataSources) && row.dataSources.length > 0, "data sources are stored");
  t.check(
    row.projections.every((p) => p.demand !== null || p.demandSource === "unavailable"),
    "a projection with no demand records why, rather than storing a zero",
  );

  t.section("Comparison against actuals");

  const comparison = await Store.compareToActual(project.userId, id);
  t.check(Array.isArray(comparison.rows), "the comparison returns rows");
  t.check(comparison.note.length > 10, "and explains itself either way");

  if (comparison.rows.length === 0) {
    t.check(
      comparison.note.includes("Search Console") || comparison.note.includes("elapsed"),
      "with no elapsed months or no data, it says which, rather than reporting a zero variance",
    );
  } else {
    t.check(
      comparison.rows.every((r) => Number.isFinite(r.variancePercent)),
      "every compared month has a real variance",
    );
  }

  const listed = await Store.listForecasts(project.userId, project.id);
  t.check(
    listed.some((s) => s.id === id),
    "the saved forecast appears in the list",
  );

  t.section("Authorization");

  const stranger = await Store.listForecasts("not-a-real-user", project.id);
  t.check(stranger.length === 0, "another user sees none of this project's forecasts");

  const strangerCompare = await Store.compareToActual("not-a-real-user", id);
  t.check(
    strangerCompare.rows.length === 0 && strangerCompare.note === "Forecast not found.",
    "and cannot compare one they do not own",
  );

  t.check(
    (await Store.deleteForecast("not-a-real-user", id)) === false,
    "nor delete it",
  );
  t.check(await Store.deleteForecast(project.userId, id), "the owner can delete it");
  created.pop();
} catch (err) {
  console.error("\n" + String(err?.stack ?? err));
  t.check(false, "the suite ran without throwing");
} finally {
  for (const id of created) {
    await prisma.foresightForecast.deleteMany({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
  built.cleanup();
}

process.exit(t.report() === 0 ? 0 : 1);
