/**
 * Whether the target position is actually available to this page.
 *
 * The failure mode this exists to prevent: a user types "position 1", the tool
 * multiplies the search volume by the position-1 click rate, and reports a
 * number that would require outranking three national publishers with a page
 * that has forty backlinks and no internal links pointing at it. The arithmetic
 * is correct and the forecast is worthless.
 *
 * So a target is an input to be judged, not an instruction to be obeyed. This
 * file measures four gaps against the pages already ranking, decides how much
 * of the intended movement is plausible, and returns the position it actually
 * expects — which the traffic model then uses instead of the target.
 *
 * It is a planning model. There is no validated universal formula for "will
 * this page rank", and anyone claiming one is selling something. What it does
 * offer is a consistent, inspectable ordering: the reasons are returned
 * alongside the verdict so a person who disagrees can see precisely which gap
 * drove it.
 */

import type {
  ForesightProvenance,
  Gap,
  Reachability,
  ReachabilityBand,
} from "@/lib/foresight/types";

export type CompetitorSignal = {
  position: number;
  domainAuthority: number | null;
  pageAuthority: number | null;
  domainLinkingDomains: number | null;
  wordCount: number;
};

export type ReachabilityInput = {
  /** Where the page sits now. Null when it does not rank at all. */
  currentPosition: number | null;
  targetPosition: number;

  /** This site's authority score, 0–100. Null when not computed. */
  domainAuthority: number | null;
  /** The specific page's authority, 0–100. Null when unknown. */
  pageAuthority: number | null;

  /** The pages currently ranking, from a cached SERP. Empty when none. */
  competitors: CompetitorSignal[];

  /** Words on the page. Zero when the page does not exist yet. */
  wordCount: number;
  /** Internal links pointing at the page, from the audit. */
  internalLinks: number;
  /** Blocking or serious technical issues on the page. */
  technicalIssues: number;
  /** True when the audit found the page indexable. */
  indexable: boolean;
  /** True when a page on this site already targets this intent. */
  hasMatchingPage: boolean;
  /** Related pages on the site covering the same topic. */
  topicalDepth: number;

  /**
   * Positions this keyword has held over time, oldest first.
   *
   * Momentum is the single most useful signal here and the one most often
   * missing: a keyword that has climbed 40 → 22 → 14 is telling you something a
   * static snapshot cannot.
   */
  history: number[];
};

/** Positions beyond this are treated as "not ranking" for gap purposes. */
const UNRANKED = 60;

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * How far this site's authority sits below the pages holding the target band.
 *
 * Measured against the results at and above the target rather than against all
 * ten: to reach position 3 you have to beat what is in the top 3, and the
 * weakest result on page one is not the bar.
 */
function authorityGap(input: ReachabilityInput): Gap {
  const contenders = input.competitors.filter((c) => c.position <= Math.max(3, input.targetPosition));
  const theirs = median(
    contenders
      .map((c) => c.domainAuthority)
      .filter((v): v is number => v !== null),
  );

  if (theirs === null || input.domainAuthority === null) {
    return {
      label: "Authority",
      size: 50,
      detail:
        "No link-graph data for this site or for the pages ranking above it, so the authority gap is unknown and treated as neutral rather than assumed to be zero.",
      provenance: "unavailable",
    };
  }

  const deficit = theirs - input.domainAuthority;
  // A 30-point authority deficit is about as wide as this gap gets in practice.
  const size = clamp((deficit / 30) * 100);

  return {
    label: "Authority",
    size,
    detail:
      deficit <= 0
        ? `This site scores ${String(Math.round(input.domainAuthority))} against a median of ${String(Math.round(theirs))} in the target band — no authority disadvantage.`
        : `This site scores ${String(Math.round(input.domainAuthority))} against a median of ${String(Math.round(theirs))} for the pages holding position ${String(Math.max(3, input.targetPosition))} and above.`,
    provenance: "derived",
  };
}

/** Whether there is a page here at all, and whether it is substantial enough. */
function contentGap(input: ReachabilityInput): Gap {
  if (!input.hasMatchingPage || input.wordCount === 0) {
    return {
      label: "Content",
      size: 90,
      detail:
        "No page on this site targets this query yet. The forecast assumes one is written, which is the largest single piece of work behind this keyword.",
      provenance: "derived",
    };
  }

  const theirs = median(input.competitors.map((c) => c.wordCount).filter((w) => w > 0));
  const depthPenalty = input.topicalDepth >= 3 ? 0 : (3 - input.topicalDepth) * 8;

  if (theirs === null || theirs === 0) {
    return {
      label: "Content",
      size: clamp(depthPenalty + (input.wordCount < 600 ? 30 : 10)),
      detail: `The page has ${String(input.wordCount)} words. No competitor word counts were captured, so depth is judged against the site's own topical coverage only.`,
      provenance: "estimated",
    };
  }

  const ratio = input.wordCount / theirs;
  const lengthGap = ratio >= 1 ? 0 : clamp((1 - ratio) * 90);

  return {
    label: "Content",
    size: clamp(lengthGap * 0.75 + depthPenalty),
    detail: `${String(input.wordCount)} words against a competitor median of ${String(Math.round(theirs))}${input.topicalDepth < 3 ? `, with ${String(input.topicalDepth)} related pages supporting the topic` : ""}.`,
    provenance: "derived",
  };
}

/** Anything on the page that stops it competing regardless of its content. */
function technicalGap(input: ReachabilityInput): Gap {
  /*
   * A page that does not exist has unknown technical health, not perfect
   * technical health. Scoring it zero handed a quarter of the reachability
   * weight, free, to the one case with the least evidence behind it — and
   * "write a new page and rank it third" came back as Realistic.
   */
  if (!input.hasMatchingPage) {
    return {
      label: "Technical",
      size: 50,
      detail:
        "No page exists yet, so its technical health cannot be assessed. Treated as unknown rather than assumed to be clean.",
      provenance: "unavailable",
    };
  }

  if (!input.indexable) {
    return {
      label: "Technical",
      size: 100,
      detail:
        "The audit found this page non-indexable. Until that is fixed no ranking improvement is possible at all, so the forecast for this keyword is zero regardless of every other input.",
      provenance: "real",
    };
  }

  const linkPenalty = input.internalLinks >= 5 ? 0 : (5 - input.internalLinks) * 8;
  const issuePenalty = Math.min(50, input.technicalIssues * 12);

  return {
    label: "Technical",
    size: clamp(linkPenalty + issuePenalty),
    detail:
      input.technicalIssues === 0 && input.internalLinks >= 5
        ? `No blocking issues, ${String(input.internalLinks)} internal links pointing here.`
        : `${String(input.technicalIssues)} issue${input.technicalIssues === 1 ? "" : "s"} on the page and ${String(input.internalLinks)} internal link${input.internalLinks === 1 ? "" : "s"} pointing at it.`,
    provenance: "derived",
  };
}

/** How crowded and how far away the target position is. */
function serpGap(input: ReachabilityInput): Gap {
  const current = input.currentPosition ?? UNRANKED;
  const distance = Math.max(0, current - input.targetPosition);

  // Climbing from 30 to 3 is a different problem from climbing from 5 to 3, and
  // the difficulty is far from linear in the number of positions.
  const distanceScore = clamp((Math.log10(distance + 1) / Math.log10(UNRANKED)) * 100);

  const strongRivals = input.competitors.filter(
    (c) => c.position <= input.targetPosition && (c.domainAuthority ?? 0) >= 60,
  ).length;

  return {
    label: "SERP",
    size: clamp(distanceScore * 0.7 + strongRivals * 10),
    detail:
      input.currentPosition === null
        ? `Not currently ranking, so the whole distance to position ${String(input.targetPosition)} has to be covered${strongRivals > 0 ? `, past ${String(strongRivals)} high-authority result${strongRivals === 1 ? "" : "s"}` : ""}.`
        : `${String(distance)} position${distance === 1 ? "" : "s"} to cover${strongRivals > 0 ? `, past ${String(strongRivals)} high-authority result${strongRivals === 1 ? "" : "s"}` : ""}.`,
    provenance: input.competitors.length > 0 ? "derived" : "estimated",
  };
}

/**
 * Whether the keyword is already moving, and which way.
 *
 * Returns a multiplier on achievement. A page climbing steadily is evidence
 * that the work already done is working; a page sliding is evidence that
 * something is wrong which the plan may not have identified.
 */
function momentum(history: number[]): { factor: number; reason: string | null } {
  const points = history.filter((p) => Number.isFinite(p) && p > 0);
  if (points.length < 3) return { factor: 1, reason: null };

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const change = first - last;

  if (change >= 3) {
    return {
      factor: 1.15,
      reason: `Already climbing — position ${String(Math.round(first))} to ${String(Math.round(last))} over ${String(points.length)} checks.`,
    };
  }
  if (change <= -3) {
    return {
      factor: 0.8,
      reason: `Losing ground — position ${String(Math.round(first))} to ${String(Math.round(last))} over ${String(points.length)} checks. Something is working against this page.`,
    };
  }
  return { factor: 1, reason: null };
}

function bandFor(achievement: number, gaps: Gap[]): ReachabilityBand {
  if (gaps.some((g) => g.size >= 100 && g.provenance === "real")) return "too-ambitious";
  if (achievement >= 0.75) return "likely";
  if (achievement >= 0.5) return "realistic";
  if (achievement >= 0.25) return "stretch";
  return "too-ambitious";
}

/**
 * Judges one keyword's target.
 *
 * `achievement` is the headline: the share of the distance from today's
 * position to the target that the model expects to actually close. The traffic
 * forecast multiplies by this rather than by the target, which is what stops a
 * user from forecasting their way to position 1 on every keyword at once.
 */
export function assessReachability(input: ReachabilityInput): Reachability {
  const gaps = {
    authority: authorityGap(input),
    content: contentGap(input),
    technical: technicalGap(input),
    serp: serpGap(input),
  };

  const list = [gaps.authority, gaps.content, gaps.technical, gaps.serp];

  /*
   * Weighted so that the two gaps a person can close by working — content and
   * technical — matter more than the one they largely cannot. Authority moves
   * on a scale of quarters, and a model that let it dominate would tell every
   * small site that nothing is worth doing, which is both discouraging and
   * false.
   */
  const weighted =
    gaps.content.size * 0.3 +
    gaps.technical.size * 0.25 +
    gaps.serp.size * 0.3 +
    gaps.authority.size * 0.15;

  const mo = momentum(input.history);
  const raw = (1 - weighted / 100) * mo.factor;

  // A hard technical block is not a matter of degree.
  const blocked = !input.indexable;
  const achievement = blocked ? 0 : Math.max(0.05, Math.min(0.95, raw));

  const current = input.currentPosition ?? UNRANKED;

  /*
   * A keyword already at or above its target has nothing to gain, and the
   * arithmetic left alone actively harms it: position 1 aimed at position 3
   * came out as 1.6, because closing "the gap to the target" from above means
   * moving down. It rendered as a forecast that ranking first was worth giving
   * up, which is not a thing anyone would ever mean.
   */
  const expectedPosition =
    blocked || current <= input.targetPosition
      ? current
      : Math.max(1, current - (current - input.targetPosition) * achievement);

  const reasons: string[] = [];
  for (const gap of [...list].sort((a, b) => b.size - a.size)) {
    if (gap.size >= 40) reasons.push(`${gap.label}: ${gap.detail}`);
  }
  if (mo.reason !== null) reasons.push(mo.reason);
  if (reasons.length === 0) reasons.push("No significant gap found against the pages currently ranking.");

  /*
   * Evidence is tracked separately from the verdict. A confident-looking
   * "Likely" built on three unavailable inputs should not read the same as one
   * built on a full SERP, a fresh audit and six months of rank history.
   */
  const sources: ForesightProvenance[] = list.map((g) => g.provenance);
  const strong = sources.filter((s) => s === "real" || s === "derived").length;
  const evidence = Math.min(
    1,
    strong / 4 + (input.history.length >= 3 ? 0.15 : 0) + (input.competitors.length > 0 ? 0.1 : 0),
  );

  return {
    band: bandFor(achievement, list),
    achievement,
    gaps,
    expectedPosition: Math.round(expectedPosition * 10) / 10,
    reasons,
    evidence: Math.round(evidence * 100) / 100,
  };
}
