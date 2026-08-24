/**
 * The three futures, and exactly what separates them.
 *
 * A scenario selector is worthless if the three options are the same model with
 * the output multiplied by 0.7, 1.0 and 1.3 — that is one forecast wearing
 * three hats, and it teaches the reader nothing about which assumption is doing
 * the work. Here each scenario changes named, visible levers, and the panel
 * shows them, so "aggressive" means something a person can disagree with:
 * rankings move further, the site converts more of that movement into clicks,
 * and the work gets done faster.
 */

import type { Assumptions, AssumptionNote, Horizon, Scenario } from "@/lib/foresight/types";

type Levers = Pick<
  Assumptions,
  "rankAchievement" | "ctrMultiplier" | "timeMultiplier" | "rampShare"
>;

/**
 * Central assumptions per scenario.
 *
 * `rankAchievement` is the share of the intended gap to the target position the
 * model expects to close. Even the aggressive case stops short of 1.0: aiming
 * ten keywords at position 3 and landing all ten at position 3 is not a bold
 * forecast, it is a fantasy, and building it into the top of the range would
 * make every number above the expected case useless.
 */
const LEVERS: Record<Scenario, Levers> = {
  conservative: {
    rankAchievement: 0.45,
    ctrMultiplier: 0.85,
    timeMultiplier: 1.5,
    rampShare: 0.65,
  },
  expected: {
    rankAchievement: 0.7,
    ctrMultiplier: 1.0,
    timeMultiplier: 1.0,
    rampShare: 0.5,
  },
  aggressive: {
    rankAchievement: 0.9,
    ctrMultiplier: 1.15,
    timeMultiplier: 0.7,
    rampShare: 0.35,
  },
};

export const SCENARIO_SUMMARY: Record<Scenario, string> = {
  conservative:
    "Rankings move about half as far as intended, click-through comes in below the modelled curve, and the work takes half again as long.",
  expected:
    "Rankings close most of the gap to the target, click-through matches the modelled curve, and the work lands on schedule.",
  aggressive:
    "Rankings close nearly all of the gap, click-through beats the curve, and the work is delivered ahead of schedule.",
};

export const DEFAULT_TARGET_POSITION = 3;

export function defaultAssumptions(
  scenario: Scenario,
  horizonMonths: Horizon,
): Assumptions {
  return {
    horizonMonths,
    scenario,
    ...LEVERS[scenario],
    conversionRate: null,
    revenuePerConversion: null,
    contentVelocity: {
      articlesPerMonth: 2,
      optimisationsPerMonth: 4,
      internalLinksPerMonth: 10,
    },
    defaultTargetPosition: DEFAULT_TARGET_POSITION,
  };
}

/**
 * Applies user overrides on top of a scenario's defaults.
 *
 * Anything the caller supplies wins, and `describeAssumptions` marks it as
 * user-set so the methodology panel can distinguish "the model assumed this"
 * from "you told it this". Silently absorbing an override into the defaults
 * would make the two indistinguishable a month later.
 */
export function withOverrides(
  base: Assumptions,
  overrides: Partial<Assumptions>,
): Assumptions {
  return {
    ...base,
    ...overrides,
    contentVelocity: { ...base.contentVelocity, ...(overrides.contentVelocity ?? {}) },
  };
}

/** Every lever, in the words the methodology drawer shows. */
export function describeAssumptions(
  assumptions: Assumptions,
  overrides: Partial<Assumptions> = {},
): AssumptionNote[] {
  const defaults = defaultAssumptions(assumptions.scenario, assumptions.horizonMonths);
  const set = (key: keyof Assumptions): boolean => overrides[key] !== undefined;

  const notes: AssumptionNote[] = [
    {
      label: "Scenario",
      value: assumptions.scenario,
      why: SCENARIO_SUMMARY[assumptions.scenario],
      userSet: true,
    },
    {
      label: "Forecast horizon",
      value: `${String(assumptions.horizonMonths)} months`,
      why: "Everything below is totalled across this window.",
      userSet: true,
    },
    {
      label: "Ranking achievement",
      value: `${String(Math.round(assumptions.rankAchievement * 100))}% of the gap to target`,
      why: "How much of the distance between today's position and the target the model expects to actually close. Never 100%, because aiming at a position is not the same as holding it.",
      userSet: set("rankAchievement") || assumptions.rankAchievement !== defaults.rankAchievement,
    },
    {
      label: "Click-through multiplier",
      value: `×${assumptions.ctrMultiplier.toFixed(2)}`,
      why: "Applied to the modelled CTR to reflect how well titles, descriptions and rich results are executed.",
      userSet: set("ctrMultiplier") || assumptions.ctrMultiplier !== defaults.ctrMultiplier,
    },
    {
      label: "Timing multiplier",
      value: `×${assumptions.timeMultiplier.toFixed(2)}`,
      why: "Stretches or compresses every time-to-rank estimate. Above 1 means slower than the central case.",
      userSet: set("timeMultiplier") || assumptions.timeMultiplier !== defaults.timeMultiplier,
    },
    {
      label: "Ramp",
      value: `${String(Math.round(assumptions.rampShare * 100))}% of the horizon`,
      why: "Improvements do not land on day one. This share of the window is spent ramping towards full effect, so early months contribute less.",
      userSet: set("rampShare") || assumptions.rampShare !== defaults.rampShare,
    },
    {
      label: "Target position",
      value: `Position ${String(assumptions.defaultTargetPosition)}`,
      why: "Where selected keywords are aimed, unless a keyword has its own target. Reachability decides whether the model believes it.",
      userSet: set("defaultTargetPosition"),
    },
    {
      label: "Execution capacity",
      value: `${String(assumptions.contentVelocity.articlesPerMonth)} articles, ${String(assumptions.contentVelocity.optimisationsPerMonth)} optimisations, ${String(assumptions.contentVelocity.internalLinksPerMonth)} internal links per month`,
      why: "Caps how much of the action plan can land inside the horizon. Work that cannot be scheduled does not contribute traffic.",
      userSet: set("contentVelocity"),
    },
  ];

  if (assumptions.conversionRate !== null) {
    notes.push({
      label: "Conversion rate",
      value: `${(assumptions.conversionRate * 100).toFixed(2)}%`,
      why: "Supplied by you. Applied to incremental clicks to model conversions. Nothing in the system measures this.",
      userSet: true,
    });
  }

  if (assumptions.revenuePerConversion !== null) {
    notes.push({
      label: "Value per conversion",
      value: assumptions.revenuePerConversion.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }),
      why: "Supplied by you. Multiplies modelled conversions into modelled revenue.",
      userSet: true,
    });
  }

  return notes;
}

/**
 * The share of full effect available in a given month of the horizon.
 *
 * Ranking work does not switch on. A page reworked in month one is not at its
 * new position in month one, and a forecast that credits it immediately front-
 * loads traffic that will not arrive. The curve is a simple ramp to 1.0 across
 * the ramp share of the window, then flat.
 */
export function rampFactor(
  monthIndex: number,
  horizonMonths: number,
  rampShare: number,
): number {
  const rampMonths = Math.max(1, Math.round(horizonMonths * rampShare));
  if (monthIndex >= rampMonths) return 1;
  return (monthIndex + 1) / (rampMonths + 1);
}
