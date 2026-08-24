/**
 * The Foresight engine's maths, tested without a database or a model.
 *
 * Everything here is a pure function on purpose, and that is the design point
 * rather than a testing convenience: a forecast has to be reproducible from its
 * inputs six months after it was made, which means no part of it may depend on
 * what the database happened to hold that afternoon.
 *
 * The cases that matter most are the refusals. A forecasting engine fails
 * quietly — it produces a plausible number from nothing and nobody notices — so
 * a good half of what follows checks that it declines to answer: no history, no
 * demand, no CTR evidence, a blocked page, a target nobody could reach.
 *
 *   node scripts/test-foresight.mjs
 */
import { checker, compile } from "./compile.mjs";


/*
 * These checks are pure functions, but a compiled module in the graph
 * imports the Prisma client, which validates its connection string at
 * import time. Nothing here opens a connection - the URL only has to
 * parse, so the suite stays runnable with no database and no .env.
 */
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";
const built = compile(
  [
    "lib/db.ts",
    "lib/metrics/provenance.ts",
    "lib/keywords/ctr.ts",
    "lib/foresight/types.ts",
    "lib/foresight/scenario.ts",
    "lib/foresight/trend.ts",
    "lib/foresight/reachability.ts",
    "lib/foresight/time-to-rank.ts",
    "lib/foresight/simulate.ts",
    "lib/foresight/plan.ts",
    "lib/foresight/backtest.ts",
    "lib/foresight/readiness.ts",
    "lib/foresight/opportunities.ts",
    "lib/foresight/serp-features.ts",
    "lib/foresight/ctr.ts",
  ],
  { prefix: ".fstest-" },
);

const Types = await built.load("lib/foresight/types.ts");
const Scenario = await built.load("lib/foresight/scenario.ts");
const Trend = await built.load("lib/foresight/trend.ts");
const Reach = await built.load("lib/foresight/reachability.ts");
const Time = await built.load("lib/foresight/time-to-rank.ts");
const Sim = await built.load("lib/foresight/simulate.ts");
const Plan = await built.load("lib/foresight/plan.ts");
const Back = await built.load("lib/foresight/backtest.ts");
const Ready = await built.load("lib/foresight/readiness.ts");
const Opp = await built.load("lib/foresight/opportunities.ts");
const Serp = await built.load("lib/foresight/serp-features.ts");
const Ctr = await built.load("lib/foresight/ctr.ts");

const t = checker();

/* ---------------------------------------------------------------------- */
t.section("Provenance");

t.check(
  Types.weakestOf("real", "modeled") === "modeled",
  "a calculation over a measurement and a model is modeled, not real",
);
t.check(
  Types.weakestOf("real", "derived", "unavailable") === "unavailable",
  "one unavailable input makes the whole thing unavailable",
);
t.check(
  Types.weakestOf("modeled", "estimated") === "estimated",
  "an estimate is weaker than a model, because a model has real inputs",
);
t.check(Types.weakestOf() === "unavailable", "nothing at all is unavailable");
t.check(
  Types.unavailableFigure("no source").value === null,
  "an unavailable figure carries null, never zero — zero is a measurement",
);

/* ---------------------------------------------------------------------- */
t.section("CTR model");

const fallback = Ctr.fallbackCtrModel("Nothing synced.");
t.check(fallback.summary.source === "fallback", "with no data the curve is the industry one");
t.check(fallback.summary.sampleSize === 0, "and it claims no sample behind it");
t.check(
  fallback.summary.note.includes("industry-average"),
  "and says so in the note rather than implying measurement",
);
t.check(fallback.rate(1) > fallback.rate(5), "position 1 beats position 5");
t.check(fallback.rate(5) > fallback.rate(10), "and 5 beats 10");
t.check(fallback.rate(0.5) === 0, "an impossible position earns nothing");
t.check(
  Math.abs(fallback.rate(4.5) - (fallback.rate(4) + fallback.rate(5)) / 2) < 0.005,
  "fractional positions interpolate, so a drift from 4.0 to 4.9 shows",
);

/* ---------------------------------------------------------------------- */
t.section("SERP features");

t.check(
  Serp.featuresIn({ ai_overview: { text: "x" }, organic_results: [] }).includes("ai_overview"),
  "an AI Overview in the cached payload is detected",
);
t.check(
  Serp.featuresIn({ ads: [] }).length === 0,
  "an empty feature array is not a feature",
);
t.check(Serp.featuresIn(null).length === 0, "a missing payload detects nothing");
t.check(
  Serp.featuresIn({ related_questions: [{ question: "a" }], inline_videos: [{}] }).length === 2,
  "multiple features are all detected",
);
t.check(
  Serp.DEFAULT_ADJUSTMENTS.ai_overview < Serp.DEFAULT_ADJUSTMENTS.inline_images,
  "a feature that answers the query costs more clicks than one that decorates",
);
t.check(
  Object.values(Serp.DEFAULT_ADJUSTMENTS).every((m) => m > 0 && m <= 1),
  "no default adjustment claims a feature increases organic clicks",
);

/* ---------------------------------------------------------------------- */
t.section("Baseline and trend");

const daily = (n, fn) =>
  Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(2025, 0, 1));
    date.setUTCDate(date.getUTCDate() + i);
    return { date, clicks: fn(i), impressions: fn(i) * 20, position: 8 };
  });

const emptyBaseline = Trend.buildBaseline([], 6, false);
t.check(
  emptyBaseline.horizonClicks.value === null,
  "no history produces no baseline — not a flat line at zero",
);
t.check(
  emptyBaseline.horizonClicks.provenance === "unavailable",
  "and it is labelled unavailable",
);

const shortBaseline = Trend.buildBaseline(daily(30, () => 100), 6, false);
t.check(
  shortBaseline.horizonClicks.value === null,
  "30 days is below the trend floor, so nothing is projected",
);

const growing = Trend.buildBaseline(daily(400, (i) => 100 + i), 6, false);
t.check(growing.shape === "growing", "a rising series is detected as growing");
t.check(growing.projection.length === 6, "the horizon is projected month by month");
t.check(
  growing.projection.every((p) => p.clicks.provenance === "modeled"),
  "every projected month is labelled modeled",
);

const straightLine = growing.projection.map((p) => p.clicks.value);
const firstStep = straightLine[1] - straightLine[0];
const lastStep = straightLine[5] - straightLine[4];
t.check(
  lastStep < firstStep,
  "the trend is damped, so a good quarter does not extrapolate to infinity",
);

const declining = Trend.buildBaseline(daily(400, (i) => Math.max(10, 500 - i)), 6, false);
t.check(declining.shape === "declining", "a falling series is detected as declining");
t.check(
  declining.projection.every((p) => p.clicks.value >= 0),
  "a declining projection never goes negative",
);

const flat = Trend.buildBaseline(daily(400, () => 250), 6, false);
t.check(flat.shape === "flat", "a level series is flat, not a spurious trend");

t.check(
  Trend.theilSen([1, 2, 3, 4, 5]).slope === 1,
  "Theil-Sen finds a clean slope",
);
t.check(
  Math.abs(Trend.theilSen([1, 2, 3, 900, 5]).slope - 1) < 0.6,
  "and ignores a single catastrophic month that would tilt least squares",
);

const seasonalDaily = daily(365 * 2, (i) => {
  const month = new Date(Date.UTC(2025, 0, 1 + i)).getUTCMonth();
  return month === 11 ? 400 : 100;
});
const seasonal = Trend.buildBaseline(seasonalDaily, 12, true);
t.check(seasonal.seasonality !== null, "two years of data reveals a seasonal pattern");
t.check(
  seasonal.seasonality?.peakMonth === 11,
  "and finds the right peak month",
);
t.check(
  Trend.buildBaseline(daily(200, () => 100), 6, true).seasonality === null,
  "under a year, seasonality is not invented",
);

const shifted = Trend.buildBaseline(
  daily(400, (i) => (i < 200 ? 100 : 300)),
  6,
  false,
);
t.check(shifted.changepoints.length > 0, "an abrupt level shift is reported");

/* ---------------------------------------------------------------------- */
t.section("Reachability");

const baseInput = {
  currentPosition: 8,
  targetPosition: 3,
  domainAuthority: 50,
  pageAuthority: null,
  competitors: [
    { position: 1, domainAuthority: 55, pageAuthority: null, domainLinkingDomains: 100, wordCount: 1500 },
    { position: 2, domainAuthority: 52, pageAuthority: null, domainLinkingDomains: 90, wordCount: 1400 },
    { position: 3, domainAuthority: 48, pageAuthority: null, domainLinkingDomains: 80, wordCount: 1300 },
  ],
  wordCount: 1600,
  internalLinks: 8,
  technicalIssues: 0,
  indexable: true,
  hasMatchingPage: true,
  topicalDepth: 5,
  history: [],
};

const strong = Reach.assessReachability(baseInput);
t.check(strong.band === "likely", "a strong page close to target is likely");
t.check(
  strong.expectedPosition < baseInput.currentPosition,
  "and the expected position improves on today's",
);
t.check(
  strong.expectedPosition >= baseInput.targetPosition,
  "but never overshoots the target it was aimed at",
);

const blocked = Reach.assessReachability({ ...baseInput, indexable: false });
t.check(blocked.band === "too-ambitious", "a non-indexable page cannot reach anything");
t.check(blocked.achievement === 0, "and closes none of the gap");
t.check(
  blocked.expectedPosition === baseInput.currentPosition,
  "its expected position does not move at all",
);
t.check(
  blocked.gaps.technical.provenance === "real",
  "because the audit measured it, not modelled it",
);

const noPage = Reach.assessReachability({
  ...baseInput,
  currentPosition: null,
  hasMatchingPage: false,
  wordCount: 0,
  internalLinks: 0,
});
t.check(
  noPage.gaps.technical.provenance === "unavailable",
  "a page that does not exist has unknown technical health, not perfect health",
);
t.check(noPage.gaps.content.size >= 80, "no page at all is the largest content gap there is");
t.check(
  noPage.band === "stretch" || noPage.band === "too-ambitious",
  "and ranking from nothing is not called likely",
);

const unknownAuthority = Reach.assessReachability({
  ...baseInput,
  domainAuthority: null,
  competitors: [],
});
t.check(
  unknownAuthority.gaps.authority.provenance === "unavailable",
  "an unmeasurable authority gap is unavailable, not zero",
);
t.check(
  unknownAuthority.evidence < strong.evidence,
  "and the verdict carries visibly less evidence behind it",
);

const climbing = Reach.assessReachability({ ...baseInput, history: [30, 20, 12] });
const sliding = Reach.assessReachability({ ...baseInput, history: [12, 20, 30] });
t.check(
  climbing.achievement > sliding.achievement,
  "a keyword already climbing beats one already sliding",
);
t.check(
  sliding.reasons.some((r) => r.includes("Losing ground")),
  "and the slide is named in the reasons rather than buried in the score",
);

const alreadyThere = Reach.assessReachability({
  ...baseInput,
  currentPosition: 1,
  targetPosition: 3,
});
t.check(
  alreadyThere.expectedPosition === 1,
  "a keyword already above its target is never forecast downward to reach it",
);

const farAway = Reach.assessReachability({ ...baseInput, currentPosition: 45, targetPosition: 1 });
t.check(
  farAway.achievement < strong.achievement,
  "position 45 to 1 is harder than 8 to 3",
);

/* ---------------------------------------------------------------------- */
t.section("Time to rank");

const near = Time.estimateTimeToRank({
  currentPosition: 5,
  targetPosition: 3,
  reachability: strong,
  pageExists: true,
  domainAuthority: 60,
  timeMultiplier: 1,
});
const far = Time.estimateTimeToRank({
  currentPosition: 40,
  targetPosition: 3,
  reachability: noPage,
  pageExists: false,
  domainAuthority: 20,
  timeMultiplier: 1,
});

t.check(near.expectedDays < far.expectedDays, "a short climb takes less time than a long one");
t.check(near.fastestDays >= 21, "nothing is claimed to move inside three weeks");
t.check(far.slowerDays <= 400, "and nothing is projected beyond a year");
t.check(
  near.fastestDays < near.expectedDays && near.expectedDays < near.slowerDays,
  "the three cases are ordered",
);
t.check(
  far.drivers.some((d) => d.includes("written first")),
  "writing the page is named as part of why it takes longer",
);

const slowScenario = Time.estimateTimeToRank({
  currentPosition: 5,
  targetPosition: 3,
  reachability: strong,
  pageExists: true,
  domainAuthority: 60,
  timeMultiplier: 1.5,
});
t.check(
  slowScenario.expectedDays > near.expectedDays,
  "the conservative scenario's timing multiplier actually slows the estimate",
);

/* ---------------------------------------------------------------------- */
t.section("Scenarios");

const conservative = Scenario.defaultAssumptions("conservative", 6);
const expected = Scenario.defaultAssumptions("expected", 6);
const aggressive = Scenario.defaultAssumptions("aggressive", 6);

t.check(
  conservative.rankAchievement < expected.rankAchievement &&
    expected.rankAchievement < aggressive.rankAchievement,
  "the scenarios differ in how far rankings move",
);
t.check(
  conservative.timeMultiplier > aggressive.timeMultiplier,
  "and in how long the work takes",
);
t.check(
  aggressive.rankAchievement < 1,
  "even the aggressive case stops short of landing every target",
);

const notes = Scenario.describeAssumptions(expected, {});
t.check(notes.length >= 8, "every lever is described for the methodology panel");
t.check(
  notes.every((n) => n.why.length > 20),
  "and each one explains itself rather than restating its own name",
);
t.check(
  !notes.some((n) => n.label === "Conversion rate"),
  "an unset conversion rate is absent, not shown as zero",
);
t.check(
  Scenario.describeAssumptions(
    { ...expected, conversionRate: 0.02, revenuePerConversion: 140 },
    {},
  ).some((n) => n.label === "Conversion rate" && n.userSet),
  "a supplied conversion rate is marked as user-set",
);

const overridden = Scenario.withOverrides(expected, { rankAchievement: 0.5 });
t.check(overridden.rankAchievement === 0.5, "an override is applied");
t.check(
  Scenario.describeAssumptions(overridden, { rankAchievement: 0.5 }).find(
    (n) => n.label === "Ranking achievement",
  ).userSet,
  "and is reported as the user's choice, not the model's",
);

t.check(Scenario.rampFactor(0, 6, 0.5) < 1, "the first month is not at full effect");
t.check(Scenario.rampFactor(5, 6, 0.5) === 1, "and the last month is");
t.check(
  Scenario.rampFactor(0, 6, 0.35) > Scenario.rampFactor(0, 6, 0.65),
  "a shorter ramp delivers more in month one",
);

/* ---------------------------------------------------------------------- */
t.section("Uncertainty");

const sim = Sim.simulate({
  baseline: [100, 110, 120, 130, 140, 150],
  incremental: [0, 10, 30, 60, 90, 120],
  uncertaintyLevel: 0.4,
  seed: "project|expected|6",
});

t.check(sim.simulated, "a forecast with movement produces a range");
t.check(
  sim.band.p10.every((v, i) => v <= sim.band.p50[i] && sim.band.p50[i] <= sim.band.p90[i]),
  "P10 never exceeds P50, which never exceeds P90",
);
t.check(sim.band.p10.every((v) => v >= 0), "no percentile goes negative");

const again = Sim.simulate({
  baseline: [100, 110, 120, 130, 140, 150],
  incremental: [0, 10, 30, 60, 90, 120],
  uncertaintyLevel: 0.4,
  seed: "project|expected|6",
});
t.check(
  JSON.stringify(sim.band) === JSON.stringify(again.band),
  "the same inputs simulate identically — a forecast must not change on refresh",
);

const wider = Sim.simulate({
  baseline: [100, 110, 120, 130, 140, 150],
  incremental: [0, 10, 30, 60, 90, 120],
  uncertaintyLevel: 0.9,
  seed: "project|expected|6",
});
const spread = (b) => b.p90.reduce((s, v, i) => s + (v - b.p10[i]), 0);
t.check(
  spread(wider.band) > spread(sim.band),
  "less evidence produces a visibly wider band",
);
t.check(
  Math.abs(sim.drivers.reduce((s, d) => s + d.share, 0) - 1) < 0.02,
  "the spread is fully attributed to named drivers",
);
t.check(
  Sim.simulate({ baseline: [], incremental: [], uncertaintyLevel: 0.5, seed: "x" }).simulated ===
    false,
  "no forecast means no band",
);

/* ---------------------------------------------------------------------- */
t.section("Plan and capacity");

t.check(Plan.quadrantFor(80, "low") === "quick-win", "high impact and low effort is a quick win");
t.check(Plan.quadrantFor(80, "high") === "strategic", "high impact and high effort is strategic");
t.check(Plan.quadrantFor(20, "low") === "maintain", "low impact and low effort is maintenance");
t.check(
  Plan.quadrantFor(20, "high") === "deprioritize",
  "low impact and high effort is deprioritised",
);

const opportunity = (i, kind, effort) => ({
  id: `o${i}`,
  kind,
  title: `t${i}`,
  detail: "d",
  impactClicks: { value: 100, provenance: "modeled", note: "" },
  impactScore: 60,
  effort,
  confidence: 0.5,
  timeToImpactDays: 30,
  action: "do it",
  keyword: `k${i}`,
  page: null,
  evidence: [],
});

const manyOpportunities = Array.from({ length: 30 }, (_, i) =>
  opportunity(i, "striking-distance", "low"),
);

const capped = Plan.buildPlan(manyOpportunities, {
  ...expected,
  horizonMonths: 3,
  contentVelocity: { articlesPerMonth: 1, optimisationsPerMonth: 2, internalLinksPerMonth: 4 },
});

t.check(
  capped.filter((a) => a.scheduledMonth !== null).length === 6,
  "capacity caps the plan — 2 optimisations a month for 3 months is 6, not 30",
);
t.check(
  capped.filter((a) => a.scheduledMonth === null).length === 24,
  "and the rest are explicitly unscheduled rather than silently counted",
);

const summary = Plan.summarisePlan(capped, {
  ...expected,
  horizonMonths: 3,
  contentVelocity: { articlesPerMonth: 1, optimisationsPerMonth: 2, internalLinksPerMonth: 4 },
});
t.check(summary.capacityLimited, "the summary says capacity is the binding constraint");
t.check(summary.scheduled + summary.unscheduled === capped.length, "and the counts add up");

const uncapped = Plan.buildPlan(manyOpportunities.slice(0, 4), {
  ...expected,
  horizonMonths: 6,
  contentVelocity: { articlesPerMonth: 4, optimisationsPerMonth: 8, internalLinksPerMonth: 40 },
});
t.check(
  uncapped.every((a) => a.scheduledMonth !== null),
  "with enough capacity everything is scheduled",
);

t.check(
  Plan.effectStartsMonth({ scheduledMonth: 2, timeToImpactDays: 60 }) === 4,
  "work scheduled in month 2 with a 60-day lag lands in month 4",
);
t.check(
  Plan.effectStartsMonth({ scheduledMonth: null, timeToImpactDays: 30 }) === null,
  "unscheduled work never lands",
);

/* ---------------------------------------------------------------------- */
t.section("Opportunity discovery");

const evidence = {
  projectId: "p",
  siteUrl: "https://example.com",
  siteHost: "example.com",
  brandTerms: ["example.com", "example", "example bakery"],
  daily: [],
  queries: [
    { query: "example.com", clicks: 900, impressions: 1000, ctr: 0.9, position: 1, days: 30 },
    { query: "example bakery", clicks: 400, impressions: 500, ctr: 0.8, position: 1, days: 30 },
    { query: "sourdough starter guide", clicks: 20, impressions: 4000, ctr: 0.005, position: 11, days: 30 },
    { query: "how to shape a boule", clicks: 5, impressions: 2000, ctr: 0.0025, position: 6, days: 30 },
  ],
  pages: [
    {
      path: "/blocked",
      url: "https://example.com/blocked",
      title: "Blocked",
      wordCount: 900,
      internalLinks: 1,
      indexable: false,
      issueCount: 2,
      blockingIssues: 1,
      clicks: 0,
      impressions: 800,
      position: 30,
    },
    {
      path: "/orphan",
      url: "https://example.com/orphan",
      title: "Orphan",
      wordCount: 1200,
      internalLinks: 1,
      indexable: true,
      issueCount: 0,
      blockingIssues: 0,
      clicks: 12,
      impressions: 1500,
      position: 14,
    },
  ],
  serps: [],
  rankHistory: [],
  contentTitles: ["Sourdough starter", "Boule shaping", "Bread tips"],
  domainAuthority: 40,
  dataCutoff: "2025-06-30",
  historyDays: 400,
  gscConnected: true,
  gscSyncedAt: new Date(),
  totalImpressions: 7500,
  rankChecks: 0,
};

const serpModel = {
  adjustments: Serp.DEFAULT_ADJUSTMENTS,
  prevalence: [],
  serpsRead: 0,
  multiplierFor: () => 1,
};

const found = Opp.findOpportunities({
  evidence,
  ctr: fallback,
  serpModel,
  targetPosition: 3,
  cannibalGroups: [],
});

t.check(found.length > 0, "opportunities are found");
t.check(
  !found.some((o) => o.keyword === "example.com" || o.keyword === "example bakery"),
  "brand and navigational searches are excluded — there is no ranking to win there",
);
t.check(
  found.some((o) => o.kind === "striking-distance" && o.keyword === "sourdough starter guide"),
  "a query at position 11 with real impressions is a striking-distance opportunity",
);
t.check(
  found.some((o) => o.kind === "technical" && o.page?.includes("/blocked")),
  "a non-indexable page with impressions is surfaced as a blocker",
);
t.check(
  found.some((o) => o.kind === "internal-links" && o.page?.includes("/orphan")),
  "a page with one internal link and real impressions is surfaced",
);
t.check(
  found.every((o) => o.action.length > 20),
  "every opportunity carries a specific action, not a category label",
);
t.check(
  new Set(found.map((o) => o.action)).size === found.length,
  "and no two actions are word-for-word identical",
);
t.check(
  found.filter((o) => o.impactClicks.value === null).every((o) => o.impactScore > 0),
  "an opportunity with no click figure is still ranked, rather than dropped or invented",
);

const duplicated = Opp.findOpportunities({
  evidence: {
    ...evidence,
    queries: [
      evidence.queries[2],
      { ...evidence.queries[2], query: "sourdough  starter  guide" },
    ],
  },
  ctr: fallback,
  serpModel,
  targetPosition: 3,
  cannibalGroups: [],
});
t.check(
  duplicated.filter((o) => o.kind === "striking-distance").length === 1,
  "the same query spelled two ways produces one opportunity, not two",
);

/* ---------------------------------------------------------------------- */
t.section("Readiness");

const bare = Ready.assessReadiness(
  {
    ...evidence,
    gscConnected: false,
    gscSyncedAt: null,
    queries: [],
    daily: [],
    historyDays: 0,
    totalImpressions: 0,
    pages: [],
    serps: [],
    rankHistory: [],
    contentTitles: [],
    rankChecks: 0,
  },
  false,
);

t.check(bare.score < 30, "a project with nothing connected scores low");
t.check(
  bare.capabilities.trafficForecast === false,
  "and is not permitted to produce a traffic forecast",
);
t.check(
  bare.capabilities.seasonality === false && bare.capabilities.backtest === false,
  "nor seasonality nor a backtest",
);
t.check(
  bare.limitation?.includes("Search Console"),
  "the limitation names the missing connection in plain words",
);
t.check(
  bare.checks.find((c) => c.id === "freshness").status === "warn",
  "freshness is not counted as a second failure for the same missing connection",
);
t.check(
  bare.checks.find((c) => c.id === "gsc").fix?.href === "/integrations",
  "and the fix links somewhere useful",
);

const ready = Ready.assessReadiness(
  { ...evidence, historyDays: 500, totalImpressions: 200_000, rankChecks: 50, serps: [{}, {}] },
  true,
);
t.check(ready.score > bare.score, "a connected project scores higher");
t.check(ready.capabilities.trafficForecast, "and may forecast traffic");
t.check(ready.capabilities.revenue, "and revenue, once conversion inputs exist");

const thin = Ready.assessReadiness({ ...evidence, historyDays: 21 }, false);
t.check(
  thin.limitation?.includes("21 days"),
  "a thin history is quantified in the limitation, not hand-waved",
);

/* ---------------------------------------------------------------------- */
t.section("Backtesting");

const short = Back.backtest(daily(60, () => 100), 3);
t.check(short.ran === false, "a short history cannot be backtested");
t.check(short.report === null, "and produces no confidence score at all");
t.check(
  short.reason.includes("180"),
  "the refusal says how much history would be needed",
);

const long = Back.backtest(daily(600, (i) => 200 + i * 0.5), 3);
t.check(long.ran, "two years of history can be backtested");
t.check(long.windows.length > 0, "over rolling windows");
t.check(long.report !== null, "and produces a report");
t.check(
  long.report.score >= 0 && long.report.score <= 1,
  "whose score is a fraction",
);
t.check(long.report.mae >= 0, "with a mean absolute error in clicks");
t.check(
  long.report.directionAccuracy >= 0.5,
  "and gets the direction of a steadily rising series right",
);
t.check(
  long.windows.every((w) => w.predicted.length === w.actual.length),
  "each window compares like for like",
);

built.cleanup();
process.exit(t.report() === 0 ? 0 : 1);
