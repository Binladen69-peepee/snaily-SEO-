/**
 * Turning a list of opportunities into work somebody can actually do.
 *
 * The step most forecasting tools skip. A ranked list of forty opportunities is
 * not a plan — it is a to-do list nobody finishes, and the forecast built on it
 * quietly assumes all forty get done. Here the plan is capped by the capacity
 * the user says they have: two articles and four optimisations a month means
 * exactly that many land, in that order, and everything below the line is shown
 * as unscheduled rather than silently counted.
 *
 * That cap is what makes the traffic forecast honest. Work that cannot be
 * scheduled inside the horizon contributes nothing to it.
 */

import type {
  Assumptions,
  Effort,
  Opportunity,
  OpportunityKind,
  PlanAction,
  Quadrant,
} from "@/lib/foresight/types";

/** Which pool of capacity each kind of work draws from. */
const CAPACITY: Record<OpportunityKind, "articles" | "optimisations" | "links"> = {
  "content-gap": "articles",
  "striking-distance": "optimisations",
  "low-ctr": "optimisations",
  cannibalization: "optimisations",
  "serp-feature": "optimisations",
  technical: "optimisations",
  "internal-links": "links",
};

/** Above this an opportunity counts as high impact for the matrix. */
const HIGH_IMPACT = 50;

export function quadrantFor(impactScore: number, effort: Effort): Quadrant {
  const highImpact = impactScore >= HIGH_IMPACT;
  const lowEffort = effort === "low";

  if (highImpact && lowEffort) return "quick-win";
  if (highImpact) return "strategic";
  if (lowEffort) return "maintain";
  return "deprioritize";
}

export const QUADRANT_NOTE: Record<Quadrant, string> = {
  "quick-win": "Worth doing this month. Meaningful upside, little work.",
  strategic: "Worth committing to. The upside justifies the cost, but it is a project.",
  maintain: "Cheap enough to do when convenient. Do not build a quarter around it.",
  deprioritize: "Expensive and unlikely to pay. Revisit only if something changes.",
};

/**
 * Schedules the plan against the stated capacity.
 *
 * Deliberately greedy rather than optimal: work is taken in the order
 * `findOpportunities` produced, which is already impact-per-effort, and dropped
 * into the first month with room in its pool. A cleverer allocator would
 * produce a marginally better schedule and a far worse explanation, and being
 * able to say "this is fourth in the queue because of these three" is worth
 * more here than the last few percent.
 */
export function buildPlan(
  opportunities: Opportunity[],
  assumptions: Assumptions,
): PlanAction[] {
  const { horizonMonths, contentVelocity } = assumptions;

  const remaining = Array.from({ length: horizonMonths }, () => ({
    articles: contentVelocity.articlesPerMonth,
    optimisations: contentVelocity.optimisationsPerMonth,
    // One "link opportunity" is a handful of links, so the monthly allowance
    // buys several of them rather than one each.
    links: Math.max(1, Math.floor(contentVelocity.internalLinksPerMonth / 4)),
  }));

  const actions: PlanAction[] = [];

  opportunities.forEach((opportunity, index) => {
    const pool = CAPACITY[opportunity.kind];

    let scheduledMonth: number | null = null;
    for (let m = 0; m < horizonMonths; m += 1) {
      if (remaining[m]![pool] <= 0) continue;
      remaining[m]![pool] -= 1;
      scheduledMonth = m;
      break;
    }

    actions.push({
      id: opportunity.id,
      order: index + 1,
      kind: opportunity.kind,
      title: opportunity.action,
      why: opportunity.detail,
      effort: opportunity.effort,
      quadrant: quadrantFor(opportunity.impactScore, opportunity.effort),
      confidence: opportunity.confidence,
      impactClicks: opportunity.impactClicks,
      timeToImpactDays: opportunity.timeToImpactDays,
      keyword: opportunity.keyword,
      page: opportunity.page,
      scheduledMonth,
    });
  });

  return actions;
}

export type PlanSummary = {
  scheduled: number;
  unscheduled: number;
  byQuadrant: Record<Quadrant, number>;
  /** True when capacity, not opportunity, is the binding constraint. */
  capacityLimited: boolean;
  note: string;
};

export function summarisePlan(
  actions: PlanAction[],
  assumptions: Assumptions,
): PlanSummary {
  const scheduled = actions.filter((a) => a.scheduledMonth !== null).length;
  const unscheduled = actions.length - scheduled;

  const byQuadrant: Record<Quadrant, number> = {
    "quick-win": 0,
    strategic: 0,
    maintain: 0,
    deprioritize: 0,
  };
  for (const a of actions) byQuadrant[a.quadrant] += 1;

  const capacityLimited = unscheduled > 0;

  return {
    scheduled,
    unscheduled,
    byQuadrant,
    capacityLimited,
    note: capacityLimited
      ? `${String(unscheduled)} of ${String(actions.length)} opportunities do not fit in ${String(assumptions.horizonMonths)} months at ${String(assumptions.contentVelocity.articlesPerMonth)} articles and ${String(assumptions.contentVelocity.optimisationsPerMonth)} optimisations a month. They are listed but contribute nothing to the forecast.`
      : `All ${String(actions.length)} opportunities fit inside the horizon at the stated capacity.`,
  };
}

/**
 * Which month an action's effect starts showing, given when it is scheduled.
 *
 * Two separate delays, and conflating them is a common way to overstate a
 * forecast: the work has to be done at all (`scheduledMonth`), and then the
 * ranking has to move (`timeToImpactDays`). A page rewritten in month four of a
 * six-month horizon contributes almost nothing to that horizon.
 */
export function effectStartsMonth(action: PlanAction): number | null {
  if (action.scheduledMonth === null) return null;
  const lagMonths = Math.ceil((action.timeToImpactDays ?? 60) / 30);
  return action.scheduledMonth + lagMonths;
}
