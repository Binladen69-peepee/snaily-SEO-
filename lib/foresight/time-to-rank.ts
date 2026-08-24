/**
 * Roughly how long the movement takes, stated as a range and never as a date.
 *
 * Nobody can tell you when a page will rank. What can be said, defensibly, is
 * that closing four positions on a page that already exists is a shorter job
 * than closing thirty on a page that does not, and that a site with authority
 * behind it moves faster than one without. That ordering is genuinely useful
 * for sequencing work, which is all this is for.
 *
 * The output is three numbers rather than one, because a single figure invites
 * being read as a commitment. "60 to 120 days" cannot be diarised.
 */

import type { Reachability, TimeToRank } from "@/lib/foresight/types";

/** Nothing meaningful is observable before Google has recrawled and settled. */
const FLOOR_DAYS = 21;

/** Beyond a year the estimate stops being a plan and becomes a wish. */
const CEILING_DAYS = 400;

export type TimeToRankInput = {
  currentPosition: number | null;
  targetPosition: number;
  reachability: Reachability;
  /** True when the page exists and only needs improving. */
  pageExists: boolean;
  /** Site-wide authority, 0–100. Null when unknown. */
  domainAuthority: number | null;
  /** Multiplier from the scenario. Above 1 is slower. */
  timeMultiplier: number;
};

export function estimateTimeToRank(input: TimeToRankInput): TimeToRank {
  const current = input.currentPosition ?? 60;
  const distance = Math.max(0, current - input.targetPosition);

  const drivers: string[] = [];

  /*
   * Base cost scales with the log of the distance, not the distance itself.
   * Moving 20 → 10 and 10 → 5 are both a halving, and both are far harder than
   * the ten-versus-five positions would suggest.
   */
  let days = FLOOR_DAYS + Math.log2(distance + 1) * 26;
  if (distance > 0) {
    drivers.push(
      `${String(distance)} position${distance === 1 ? "" : "s"} to cover from ${input.currentPosition === null ? "unranked" : `position ${String(Math.round(current))}`}.`,
    );
  }

  if (!input.pageExists) {
    days += 45;
    drivers.push("The page has to be written first, then indexed and given time to settle.");
  }

  // Every point of difficulty the reachability model found is time as well as
  // risk — the gaps have to be closed before the position can move.
  const resistance = 1 - input.reachability.achievement;
  days *= 1 + resistance * 1.4;
  if (resistance > 0.4) {
    drivers.push(
      `Reachability is ${input.reachability.band.replace("-", " ")}, so the gaps have to be closed before the position moves.`,
    );
  }

  if (input.domainAuthority !== null) {
    // A stronger site gets crawled more often and earns trust faster.
    const factor = 1.25 - Math.min(0.5, input.domainAuthority / 100) * 0.5;
    days *= factor;
    if (input.domainAuthority >= 50) {
      drivers.push(`Site authority of ${String(Math.round(input.domainAuthority))} shortens the settling period.`);
    } else if (input.domainAuthority < 25) {
      drivers.push(`Low site authority (${String(Math.round(input.domainAuthority))}) slows how quickly new work is trusted.`);
    }
  }

  days *= input.timeMultiplier;

  const expected = Math.round(Math.min(CEILING_DAYS, Math.max(FLOOR_DAYS, days)));

  /*
   * The spread widens as the estimate lengthens. A three-week job is knowable
   * within a week; a nine-month one is not knowable within three months, and
   * pretending otherwise would put a false floor under the optimistic case.
   */
  const spread = 0.35 + Math.min(0.35, expected / CEILING_DAYS);

  return {
    fastestDays: Math.max(FLOOR_DAYS, Math.round(expected * (1 - spread))),
    expectedDays: expected,
    slowerDays: Math.min(CEILING_DAYS, Math.round(expected * (1 + spread))),
    drivers,
  };
}
