import { ISSUE_LABEL, type IssueSeverity } from "@/lib/audit/types";
import {
  EFFORT_COST,
  EFFORT_LABEL,
  RECOMMENDATIONS,
} from "@/lib/intelligence/recommendations";
import type {
  DecaySignal,
  PageSnapshot,
  Score,
  ScoreReason,
} from "@/lib/intelligence/types";
import type { PagePerformance } from "@/lib/google/performance";

/**
 * Page scoring.
 *
 * Every score is a plain sum of listed reasons — the numbers in the UI add up
 * to the total on screen. Nothing is hidden, weighted secretly, or modelled.
 */

/** Points an issue contributes to Priority, by severity. */
export const PRIORITY_POINTS: Record<IssueSeverity, number> = {
  high: 25,
  medium: 12,
  low: 5,
};

/** Issue points alone can't exceed this — importance and decay fill the rest. */
const MAX_ISSUE_POINTS = 70;
const STALE_DAYS = 365;

/**
 * Trims a reason list to a points budget so the breakdown on screen always adds
 * up to the score in the heading. Reasons are dropped from the end, so the most
 * important ones survive.
 */
function capReasons(reasons: ScoreReason[], max: number): Score {
  const kept: ScoreReason[] = [];
  let total = 0;

  for (const reason of reasons) {
    const room = max - total;
    if (room <= 0) break;
    const points = Math.min(reason.points, room);
    total += points;
    kept.push(points === reason.points ? reason : { ...reason, points });
  }

  return { score: total, reasons: kept };
}

/**
 * How much a page is worth fixing, from its position in the site.
 *
 * Shallow URLs are the pages people actually land on, and heavily linked pages
 * are the ones the site itself treats as important.
 */
export function importancePoints(
  page: PageSnapshot,
  /** Real Google data for this URL, when Search Console is connected. */
  perf?: PagePerformance,
): ScoreReason | null {
  // Real traffic beats every structural guess. If Search Console knows this
  // page gets impressions, that is what "important" actually means.
  if (perf && perf.impressions > 0) {
    if (perf.clicks >= 100) {
      return {
        label: "High-traffic page",
        detail: `${formatCount(perf.clicks)} clicks in the last 28 days`,
        points: 15,
      };
    }
    if (perf.clicks >= 10) {
      return {
        label: "Earning clicks",
        detail: `${formatCount(perf.clicks)} clicks, position ${String(perf.position)}`,
        points: 11,
      };
    }
    if (perf.impressions >= 500) {
      return {
        label: "Seen but not clicked",
        detail: `${formatCount(perf.impressions)} impressions, position ${String(perf.position)}`,
        points: 9,
      };
    }
    return {
      label: "Some search visibility",
      detail: `${formatCount(perf.impressions)} impressions`,
      points: 5,
    };
  }

  // No Google data — fall back to site structure.
  const depth = page.path.split("/").filter((s) => s !== "").length;

  if (depth === 0) {
    return { label: "Home page", detail: "the most visited URL on the site", points: 15 };
  }
  if (depth === 1) {
    return { label: "Top-level page", detail: `/${page.path.split("/")[1]}`, points: 11 };
  }
  if (page.internalLinkCount >= 20) {
    return {
      label: "Heavily linked page",
      detail: `${String(page.internalLinkCount)} internal links`,
      points: 7,
    };
  }
  if (depth === 2) return { label: "Section page", points: 5 };
  return null;
}

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

/**
 * Priority Score, 0–100 — "fix this one first".
 *
 * = issue severity (capped at 70) + page importance + active decay.
 */
export function priorityScore(
  page: PageSnapshot,
  decay: DecaySignal[],
  perf?: PagePerformance,
): Score {
  if (page.issues.length === 0 && decay.length === 0) {
    return { score: 0, reasons: [] };
  }

  const reasons: ScoreReason[] = [];

  // 1. Issues, worst first.
  const issueReasons = page.issues
    .map((i) => ({
      label: ISSUE_LABEL[i.code],
      detail: i.detail,
      points: PRIORITY_POINTS[i.severity],
    }))
    .sort((a, b) => b.points - a.points);

  // Issues get their own budget so importance and decay always have room left.
  reasons.push(...capReasons(issueReasons, MAX_ISSUE_POINTS).reasons);

  // 2. Importance — only matters if there is something to fix.
  if (page.issues.length > 0) {
    const importance = importancePoints(page, perf);
    if (importance) reasons.push(importance);
  }

  // 3. Decay — a page getting worse outranks a page that has always been bad.
  const regressions = decay.filter((d) => d.code !== "stale");
  if (regressions.length > 0) {
    reasons.push({
      label: "Declining since the last crawl",
      detail: regressions.map((d) => d.detail).join(", "),
      points: 15,
    });
  } else if (decay.some((d) => d.code === "stale")) {
    reasons.push({
      label: "Content not updated in over a year",
      points: 5,
    });
  }

  return capReasons(reasons, 100);
}

/**
 * Opportunity Score, 0–100 — "biggest result for the least work".
 *
 * Each issue is worth its priority points divided by how much effort the fix
 * takes, then the whole page is scaled by how important it is. A home page with
 * three one-line fixes beats a buried page needing a rewrite.
 */
export function opportunityScore(
  page: PageSnapshot,
  perf?: PagePerformance,
): Score {
  if (page.issues.length === 0) return { score: 0, reasons: [] };

  const reasons: ScoreReason[] = page.issues
    .map((i) => {
      const rec = RECOMMENDATIONS[i.code];
      return {
        label: ISSUE_LABEL[i.code],
        detail: EFFORT_LABEL[rec.effort],
        points: Math.round(PRIORITY_POINTS[i.severity] / EFFORT_COST[rec.effort]),
      };
    })
    .sort((a, b) => b.points - a.points);

  const base = reasons.reduce((sum, r) => sum + r.points, 0);

  // Importance is a multiplier here, not an addition: it scales the payoff of
  // the fixes rather than being a reward on its own.
  const importance = importancePoints(page, perf);
  const multiplier = importance ? 1 + importance.points / 30 : 1;

  if (importance && base > 0) {
    reasons.push({
      label: importance.label,
      detail: `${multiplier.toFixed(1)}× payoff`,
      // base is an integer, so this is exactly round(base * m) - base.
      points: Math.round(base * (multiplier - 1)),
    });
  }

  return capReasons(reasons, 100);
}

/** 0–100. A page with no issues is 100. */
export function pageHealth(page: PageSnapshot): number {
  const penalty = page.issues.reduce(
    (sum, i) => sum + PRIORITY_POINTS[i.severity],
    0,
  );
  return Math.max(0, 100 - penalty);
}

/**
 * Content decay — signals that a page is worse now than it was last crawl.
 * `previous` is undefined for pages that are new since the last audit.
 */
export function detectDecay(
  page: PageSnapshot,
  previous: PageSnapshot | undefined,
  now = Date.now(),
): DecaySignal[] {
  const signals: DecaySignal[] = [];

  if (previous) {
    if (previous.wordCount > 0 && page.wordCount < previous.wordCount * 0.85) {
      const lost = previous.wordCount - page.wordCount;
      signals.push({
        code: "content_shrank",
        label: "Content shrank",
        detail: `${String(lost)} words removed (${String(previous.wordCount)} → ${String(page.wordCount)})`,
      });
    }

    if (page.issues.length > previous.issues.length) {
      const added = page.issues.length - previous.issues.length;
      signals.push({
        code: "issues_increased",
        label: "More issues than last crawl",
        detail: `${String(added)} new issue${added === 1 ? "" : "s"}`,
      });
    }

    if (
      previous.internalLinkCount >= 5 &&
      page.internalLinkCount < previous.internalLinkCount * 0.7
    ) {
      signals.push({
        code: "links_lost",
        label: "Internal links removed",
        detail: `${String(previous.internalLinkCount)} → ${String(page.internalLinkCount)} links`,
      });
    }
  }

  if (page.lastModified !== null) {
    const ageDays = (now - new Date(page.lastModified).getTime()) / 86_400_000;
    if (ageDays > STALE_DAYS) {
      signals.push({
        code: "stale",
        label: "Stale content",
        detail: `Last updated ${String(Math.round(ageDays / 30))} months ago`,
      });
    }
  }

  return signals;
}
