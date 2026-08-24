/**
 * What Foresight is allowed to say, given what it actually knows.
 *
 * This runs before any forecast and decides which parts of the engine may run
 * at all. It exists because the honest answer to "what will happen if we fix
 * these rankings?" depends entirely on how much evidence there is, and a
 * forecasting tool that produces the same confident chart with 21 days of data
 * as with three years is not a forecasting tool.
 *
 * On this deployment that is not a hypothetical. At the time of writing no
 * project has a Search Console property linked, so every one of them scores
 * low here and the traffic forecast is switched off rather than invented. The
 * parts that can run without Google — opportunity discovery, reachability, the
 * action plan — still run, because "no traffic forecast" is not the same as
 * "no useful answer".
 *
 * Every count comes from the evidence bundle that the forecast already loaded.
 * An earlier version queried independently and got a different answer to the
 * engine sitting next to it: the readiness panel reported no SERP data while
 * the opportunity list was reading 272 cached result pages. Two sources of
 * truth about the same fact is one too many.
 */

import type { Evidence } from "@/lib/foresight/evidence";
import type { Readiness, ReadinessCheck } from "@/lib/foresight/types";

/** History below this cannot support a trend, let alone a seasonal one. */
export const MIN_TREND_DAYS = 56;

/** Twelve months is the least that can show a repeating annual pattern. */
export const MIN_SEASONALITY_DAYS = 365;

/** Impressions needed before a site-specific CTR curve beats the generic one. */
export const MIN_CTR_IMPRESSIONS = 10_000;

/** Beyond this, Search Console data is old enough to mislead. */
export const STALE_SYNC_DAYS = 14;

/** Backtesting needs enough history to hold out a window and still fit. */
export const MIN_BACKTEST_DAYS = 180;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function assessReadiness(
  evidence: Evidence,
  hasConversionInputs: boolean,
): Readiness {
  const historyDays = evidence.historyDays;
  const syncAgeDays =
    evidence.gscSyncedAt === null ? null : daysBetween(evidence.gscSyncedAt, new Date());

  const trackedKeywords = evidence.rankHistory.length;
  const auditPages = evidence.pages.length;
  const serpCount = evidence.serps.length;

  const checks: ReadinessCheck[] = [];

  checks.push({
    id: "gsc",
    label: "Search Console connected",
    status: evidence.gscConnected ? "pass" : "fail",
    weight: 25,
    detail: evidence.gscConnected
      ? "First-party click, impression and position data is available."
      : "No Search Console property is linked to this project. Traffic forecasting needs it — nothing else can stand in for measured clicks.",
    fix: evidence.gscConnected
      ? undefined
      : { label: "Connect Search Console", href: "/integrations" },
  });

  checks.push({
    id: "history",
    label: "Enough history to model a trend",
    status:
      historyDays >= MIN_SEASONALITY_DAYS
        ? "pass"
        : historyDays >= MIN_TREND_DAYS
          ? "warn"
          : "fail",
    weight: 20,
    detail:
      historyDays === 0
        ? "No historical performance data."
        : historyDays >= MIN_SEASONALITY_DAYS
          ? `${String(Math.round(historyDays / 30))} months of daily data — enough for a trend and a seasonal pattern.`
          : `Only ${String(historyDays)} days of data. A trend needs ${String(MIN_TREND_DAYS)} days; seasonality needs a full year.`,
  });

  checks.push({
    id: "ctr",
    label: "Site-specific CTR curve",
    status:
      evidence.totalImpressions >= MIN_CTR_IMPRESSIONS
        ? "pass"
        : evidence.totalImpressions > 0
          ? "warn"
          : "fail",
    weight: 15,
    detail:
      evidence.totalImpressions >= MIN_CTR_IMPRESSIONS
        ? `Built from ${evidence.totalImpressions.toLocaleString()} measured impressions.`
        : evidence.totalImpressions > 0
          ? `Only ${evidence.totalImpressions.toLocaleString()} impressions — too few for a reliable curve, so the published industry curve is used and labelled.`
          : "No impression data, so a clearly-labelled industry CTR curve is used instead.",
  });

  checks.push({
    id: "rankings",
    label: "Ranking history",
    status: evidence.rankChecks >= 20 ? "pass" : trackedKeywords > 0 ? "warn" : "fail",
    weight: 10,
    detail:
      evidence.rankChecks >= 20
        ? `${String(evidence.rankChecks)} rank checks across ${String(trackedKeywords)} tracked keywords, so momentum can be measured.`
        : trackedKeywords > 0
          ? `${String(trackedKeywords)} keywords tracked but only ${String(evidence.rankChecks)} checks — momentum cannot be measured yet.`
          : "No tracked keywords. Ranking momentum is one of the strongest inputs to time-to-rank.",
    fix: trackedKeywords > 0 ? undefined : { label: "Add keywords to track", href: "/tracking" },
  });

  checks.push({
    id: "serp",
    label: "SERP data",
    status: serpCount >= 25 ? "pass" : serpCount > 0 ? "warn" : "fail",
    weight: 10,
    detail:
      serpCount > 0
        ? `${String(serpCount)} cached result pages read without spending a new API call.`
        : "No cached SERPs, so competitor strength and SERP features cannot be read.",
  });

  /*
   * Freshness is not held against a project that has never connected: the
   * missing connection is already the first and heaviest failure on this list,
   * and charging for it twice would understate how ready a newly-connected
   * project actually is.
   */
  checks.push({
    id: "freshness",
    label: "Data freshness",
    status: !evidence.gscConnected
      ? "warn"
      : syncAgeDays === null
        ? "fail"
        : syncAgeDays <= STALE_SYNC_DAYS
          ? "pass"
          : "warn",
    weight: 5,
    detail: !evidence.gscConnected
      ? "Not applicable until Search Console is connected."
      : syncAgeDays === null
        ? "Connected but never synced."
        : syncAgeDays <= 1
          ? "Synced today."
          : `Last synced ${String(syncAgeDays)} days ago.`,
  });

  checks.push({
    id: "keywords",
    label: "Keyword universe",
    status:
      trackedKeywords > 0 || evidence.queries.length > 0 || evidence.contentTitles.length > 0
        ? "pass"
        : "warn",
    weight: 5,
    detail:
      evidence.contentTitles.length > 0
        ? `${String(evidence.contentTitles.length)} published pages available as forecast targets.`
        : "No synced content or tracked keywords to forecast against.",
  });

  checks.push({
    id: "audit",
    label: "Technical audit",
    status: auditPages > 0 ? "pass" : "warn",
    weight: 5,
    detail:
      auditPages > 0
        ? `${String(auditPages)} pages crawled, so technical blockers feed reachability.`
        : "No completed site audit. Technical gaps are treated as unknown rather than as zero.",
    fix: auditPages > 0 ? undefined : { label: "Run a site audit", href: "/audit" },
  });

  checks.push({
    id: "conversion",
    label: "Conversion inputs",
    status: hasConversionInputs ? "pass" : "warn",
    weight: 5,
    detail: hasConversionInputs
      ? "Conversion rate and value supplied, so leads and revenue can be modelled."
      : "No conversion rate supplied, so the forecast stops at clicks. Nothing downstream is guessed.",
  });

  /*
   * A warn is worth half. Partial credit matters: a project with three months
   * of data is genuinely more forecastable than one with none, and collapsing
   * both to "not ready" would hide the difference.
   */
  const earned = checks.reduce(
    (sum, k) => sum + (k.status === "pass" ? k.weight : k.status === "warn" ? k.weight / 2 : 0),
    0,
  );
  const total = checks.reduce((sum, k) => sum + k.weight, 0);
  const score = Math.round((earned / total) * 100);

  const capabilities = {
    baseline: evidence.gscConnected && historyDays >= MIN_TREND_DAYS,
    trafficForecast: evidence.gscConnected && historyDays >= MIN_TREND_DAYS,
    seasonality: historyDays >= MIN_SEASONALITY_DAYS,
    siteCtrCurve: evidence.totalImpressions >= MIN_CTR_IMPRESSIONS,
    // Reachability runs on SERP and audit evidence, so it survives without
    // Google entirely — which is the whole reason Foresight is usable today.
    reachability: serpCount > 0 || auditPages > 0,
    revenue: hasConversionInputs,
    backtest: historyDays >= MIN_BACKTEST_DAYS,
  };

  let limitation: string | null = null;
  if (!evidence.gscConnected) {
    limitation =
      "No Search Console property is linked, so there is no measured traffic to forecast from. Opportunities, reachability and the action plan below are built from cached SERP data and your site audit; the traffic and revenue forecast unlocks once Search Console is connected.";
  } else if (historyDays < MIN_TREND_DAYS) {
    limitation = `Forecast confidence is limited because only ${String(historyDays)} days of historical data are available. A trend needs at least ${String(MIN_TREND_DAYS)}.`;
  } else if (historyDays < MIN_SEASONALITY_DAYS) {
    limitation = `Seasonality is not modelled: that needs a full year of history and this project has ${String(Math.round(historyDays / 30))} months. The forecast assumes no recurring seasonal pattern.`;
  }

  return { score, checks, capabilities, limitation };
}
