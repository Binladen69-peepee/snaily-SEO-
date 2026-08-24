import { factsCompleteness } from "@/lib/geo/facts";
import type { GeoIdeaView } from "@/lib/geo/idea";
import { MOMENTS, TRUST_CATEGORIES } from "@/lib/geo/config";

/**
 * GEO Lab scores — derived only from Business Facts + stored GeoIdeas.
 *
 * No historical snapshots are stored yet, so every "change since last scan"
 * field is null (UI shows "No previous scan"). Never invent prior values.
 */

export type MetricStatus = "strong" | "good" | "fair" | "weak" | "empty";

export type GeoMetric = {
  id: string;
  label: string;
  /** 0–100 when calculable; null when not enough data. */
  score: number | null;
  status: MetricStatus;
  explanation: string;
  /** Always null until a prior scan is persisted. */
  delta: number | null;
};

export type GeoNextAction = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  /** Workflow stage to open. */
  stage: GeoStageId;
  cta: string;
};

export type GeoStageId =
  | "overview"
  | "knowledge"
  | "redundancy"
  | "moments"
  | "trust"
  | "opportunities"
  | "draft"
  | "export";

export type MomentBucket = {
  id: string;
  label: string;
  displayLabel: string;
  count: number;
  highPriority: number;
  drafted: number;
  redundant: number;
};

export type GeoScoreReport = {
  visibility: GeoMetric;
  aiReadiness: GeoMetric;
  contentCoverage: GeoMetric;
  factsCompleteness: GeoMetric;
  trustSignals: GeoMetric;
  redundancyRisk: GeoMetric;
  breakdown: {
    businessFacts: number | null;
    contentCoverage: number | null;
    searchMomentCoverage: number | null;
    trustSignals: number | null;
    redundancy: number | null;
    citationReadiness: number | null;
  };
  howCalculated: { label: string; detail: string }[];
  nextActions: GeoNextAction[];
  momentBuckets: MomentBucket[];
  counts: {
    ideas: number;
    ready: number;
    drafted: number;
    redundant: number;
    momentsCovered: number;
    categoriesCovered: number;
  };
};

type FactsSlice = {
  serviceArea: string;
  travelPolicy: string;
  eventTypes: string;
  dietaryHandling: string;
  pricingLogic: string;
  leadTime: string;
  consultingScope: string;
  guestMin: number | null;
  guestMax: number | null;
  pastEvents: string[];
  neverClaim: string[];
};

/** UI aliases for the four existing moment ids — ids stay unchanged in storage. */
export const MOMENT_DISPLAY: Record<string, string> = {
  want_to_know: "Discovery",
  want_to_go: "Local / Planning",
  want_to_do: "Comparison",
  want_to_buy: "Decision",
};

function statusFromScore(score: number | null): MetricStatus {
  if (score === null) return "empty";
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 40) return "fair";
  return "weak";
}

function statusLabel(s: MetricStatus): string {
  switch (s) {
    case "strong":
      return "Strong";
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "weak":
      return "Needs work";
    default:
      return "Not enough data";
  }
}

export function metricStatusLabel(s: MetricStatus): string {
  return statusLabel(s);
}

function pct(n: number, d: number): number | null {
  if (d <= 0) return null;
  return Math.round((n / d) * 100);
}

function avg(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function metric(
  id: string,
  label: string,
  score: number | null,
  explanation: string,
): GeoMetric {
  return {
    id,
    label,
    score,
    status: statusFromScore(score),
    explanation,
    delta: null,
  };
}

export function buildGeoScoreReport(
  facts: FactsSlice,
  ideas: GeoIdeaView[],
): GeoScoreReport {
  const { filled, total } = factsCompleteness(facts);
  const factsPct = pct(filled, total);

  const drafted = ideas.filter(
    (i) => i.status === "drafted" && i.draftHtml.trim() !== "",
  );
  const redundant = ideas.filter((i) => i.redundantWith !== null);
  const ready = ideas.filter(
    (i) =>
      i.redundantWith === null &&
      !(i.status === "drafted" && i.draftHtml.trim() !== ""),
  );

  const momentsCovered = new Set(
    ideas.filter((i) => i.redundantWith === null).map((i) => i.moment),
  ).size;
  const categoriesCovered = new Set(
    ideas.filter((i) => i.redundantWith === null).map((i) => i.category),
  ).size;

  const momentCoverage = pct(momentsCovered, MOMENTS.length);
  const trustCoverage = pct(categoriesCovered, TRUST_CATEGORIES.length);

  // Content coverage: share of non-redundant ideas that already have a draft.
  const actionable = ideas.filter((i) => i.redundantWith === null);
  const contentCoverage =
    actionable.length === 0
      ? ideas.length === 0
        ? null
        : 0
      : pct(drafted.length, actionable.length);

  // Redundancy score: higher = healthier (less overlap). Risk metric inverts this.
  const redundancyHealth =
    ideas.length === 0
      ? null
      : Math.round(100 - (redundant.length / ideas.length) * 100);

  const redundancyRiskScore =
    redundancyHealth === null ? null : 100 - redundancyHealth;

  // Citation readiness: facts + drafts with FAQ + never-claim list.
  const citationParts: number[] = [];
  if (factsPct !== null) citationParts.push(factsPct);
  if (drafted.length > 0) {
    const withFaq = drafted.filter((i) => i.faq.length > 0).length;
    citationParts.push(pct(withFaq, drafted.length) ?? 0);
  } else if (ideas.length > 0) {
    citationParts.push(20);
  }
  if ((facts.neverClaim ?? []).length > 0) citationParts.push(100);
  const citationReadiness =
    citationParts.length === 0
      ? null
      : Math.round(
          citationParts.reduce((a, b) => a + b, 0) / citationParts.length,
        );

  const visibility = avg([
    factsPct,
    contentCoverage,
    momentCoverage,
    trustCoverage,
    redundancyHealth,
    citationReadiness,
  ]);

  const aiReadiness = avg([
    factsPct,
    momentCoverage,
    trustCoverage,
    citationReadiness,
  ]);

  const momentBuckets: MomentBucket[] = MOMENTS.map((m) => {
    const bucket = ideas.filter((i) => i.moment === m.id);
    const high = bucket.filter(
      (i) =>
        i.redundantWith === null &&
        (i.moment === "want_to_buy" || i.moment === "want_to_do"),
    ).length;
    return {
      id: m.id,
      label: m.label,
      displayLabel: MOMENT_DISPLAY[m.id] ?? m.label,
      count: bucket.length,
      highPriority: high,
      drafted: bucket.filter(
        (i) => i.status === "drafted" && i.draftHtml.trim() !== "",
      ).length,
      redundant: bucket.filter((i) => i.redundantWith !== null).length,
    };
  });

  const nextActions = buildNextActions({
    facts,
    factsPct,
    filled,
    total,
    ideas,
    ready,
    drafted,
    redundant,
    momentsCovered,
    categoriesCovered,
  });

  return {
    visibility: metric(
      "visibility",
      "GEO Visibility",
      visibility,
      visibility === null
        ? "Map moments after filling Business Facts to unlock this score."
        : "Composite of facts, coverage, moments, trust, redundancy and citation readiness.",
    ),
    aiReadiness: metric(
      "ai-readiness",
      "AI Search Readiness",
      aiReadiness,
      aiReadiness === null
        ? "Needs Business Facts and mapped moments."
        : "How prepared the site is to be cited by AI/search systems.",
    ),
    contentCoverage: metric(
      "content-coverage",
      "Content Coverage",
      contentCoverage,
      contentCoverage === null
        ? "No mapped ideas yet."
        : `${String(drafted.length)} of ${String(actionable.length)} non-redundant ideas drafted${
            ready.length > 0
              ? ` · ${String(ready.length)} opportunities remaining`
              : ""
          }.`,
    ),
    factsCompleteness: metric(
      "facts",
      "Business Facts",
      factsPct,
      `${String(filled)} of ${String(total)} grounding fields filled.`,
    ),
    trustSignals: metric(
      "trust",
      "Trust Signal Score",
      trustCoverage,
      trustCoverage === null
        ? "Map moments to cover trust categories."
        : `${String(categoriesCovered)} of ${String(TRUST_CATEGORIES.length)} trust categories represented.`,
    ),
    redundancyRisk: metric(
      "redundancy-risk",
      "Redundancy Risk",
      redundancyRiskScore,
      redundancyRiskScore === null
        ? "No ideas to compare yet."
        : redundancyRiskScore === 0
          ? "No redundant ideas flagged."
          : `${String(redundant.length)} idea${redundant.length === 1 ? "" : "s"} flagged as overlapping.`,
    ),
    breakdown: {
      businessFacts: factsPct,
      contentCoverage,
      searchMomentCoverage: momentCoverage,
      trustSignals: trustCoverage,
      redundancy: redundancyHealth,
      citationReadiness,
    },
    howCalculated: [
      {
        label: "Business Facts",
        detail: "Share of grounding fields filled (service area, policies, limits, past events, never-claim).",
      },
      {
        label: "Content Coverage",
        detail: "Share of non-redundant mapped ideas that already have a draft.",
      },
      {
        label: "Search Moment Coverage",
        detail: "Share of the four moments (Discovery → Decision) that have at least one idea.",
      },
      {
        label: "Trust Signals",
        detail: "Share of the six trust-content categories represented in mapped ideas.",
      },
      {
        label: "Redundancy",
        detail: "Inverse of flagged overlap — 100 means no redundant ideas in the current set.",
      },
      {
        label: "Citation Readiness",
        detail: "Blend of facts completeness, drafts with FAQ answers, and a never-claim list.",
      },
      {
        label: "GEO Visibility / AI Readiness",
        detail: "Simple averages of the components above. No prior scan is stored — deltas show “No previous scan”.",
      },
    ],
    nextActions,
    momentBuckets,
    counts: {
      ideas: ideas.length,
      ready: ready.length,
      drafted: drafted.length,
      redundant: redundant.length,
      momentsCovered,
      categoriesCovered,
    },
  };
}

function buildNextActions(input: {
  facts: FactsSlice;
  factsPct: number | null;
  filled: number;
  total: number;
  ideas: GeoIdeaView[];
  ready: GeoIdeaView[];
  drafted: GeoIdeaView[];
  redundant: GeoIdeaView[];
  momentsCovered: number;
  categoriesCovered: number;
}): GeoNextAction[] {
  const actions: GeoNextAction[] = [];

  if (input.facts.serviceArea.trim() === "") {
    actions.push({
      id: "facts-required",
      severity: "critical",
      title: "Missing Business Facts",
      detail:
        "Service area is required before mapping or drafting. Ideas are grounded in these facts — never invented.",
      stage: "knowledge",
      cta: "Complete Facts",
    });
  } else if ((input.factsPct ?? 0) < 60) {
    const missing = input.total - input.filled;
    actions.push({
      id: "facts-incomplete",
      severity: "high",
      title: "Incomplete Business Knowledge",
      detail: `${String(missing)} grounding field${missing === 1 ? "" : "s"} still empty — drafts will stay qualitative where facts are missing.`,
      stage: "knowledge",
      cta: "Complete Facts",
    });
  }

  if (input.ideas.length === 0 && input.facts.serviceArea.trim() !== "") {
    actions.push({
      id: "map-moments",
      severity: "high",
      title: "No search moments mapped",
      detail:
        "Enter a seed topic and map moments from People Also Ask, related searches, and Search Console (when connected).",
      stage: "moments",
      cta: "Map Moments",
    });
  }

  if (input.ready.length > 0) {
    const highIntent = input.ready.filter(
      (i) => i.moment === "want_to_buy" || i.moment === "want_to_do",
    );
    actions.push({
      id: "content-opps",
      severity: highIntent.length > 0 ? "high" : "medium",
      title: "Content opportunity",
      detail:
        highIntent.length > 0
          ? `${String(highIntent.length)} high-intent moment${highIntent.length === 1 ? "" : "s"} have no draft yet (${String(input.ready.length)} total ready).`
          : `${String(input.ready.length)} mapped idea${input.ready.length === 1 ? "" : "s"} ready to draft.`,
      stage: "opportunities",
      cta: "View Opportunities",
    });
  }

  if (input.redundant.length > 0) {
    actions.push({
      id: "redundancy",
      severity: "high",
      title: "Redundancy risk",
      detail: `${String(input.redundant.length)} idea${input.redundant.length === 1 ? "" : "s"} flagged for semantic / city-swap overlap with published posts or siblings.`,
      stage: "redundancy",
      cta: "Review Pages",
    });
  }

  const faqGaps = input.ready.filter((i) =>
    ["want_to_know", "want_to_do"].includes(i.moment),
  );
  if (faqGaps.length >= 3) {
    actions.push({
      id: "faq",
      severity: "medium",
      title: "FAQ opportunity",
      detail: `${String(faqGaps.length)} research / how-to moments still need answers — drafting will pull real PAA questions into FAQ blocks.`,
      stage: "draft",
      cta: "Create Content",
    });
  }

  if (
    input.drafted.length > 0 &&
    input.ready.length === 0 &&
    input.redundant.length === 0
  ) {
    actions.push({
      id: "export",
      severity: "low",
      title: "Drafts ready to export",
      detail: `${String(input.drafted.length)} draft${input.drafted.length === 1 ? "" : "s"} ready for WordPress copy-out.`,
      stage: "export",
      cta: "Open Export",
    });
  }

  if (
    input.momentsCovered > 0 &&
    input.momentsCovered < MOMENTS.length &&
    input.ideas.length > 0
  ) {
    actions.push({
      id: "moments-gap",
      severity: "medium",
      title: "Uneven moment coverage",
      detail: `Only ${String(input.momentsCovered)} of ${String(MOMENTS.length)} moment types are represented — remap or broaden the seed.`,
      stage: "moments",
      cta: "View Moments",
    });
  }

  return actions.slice(0, 6);
}

/** Pairwise redundancy among current ideas for the Redundancy Radar UI. */
export function buildRedundancyPairs(ideas: GeoIdeaView[]): {
  a: GeoIdeaView;
  b: GeoIdeaView;
  reason: string;
  risk: "high" | "medium";
}[] {
  const flagged = ideas.filter((i) => i.redundantWith !== null);
  return flagged.map((idea) => ({
    a: idea,
    b: idea,
    reason: idea.redundantWith ?? "Overlapping intent",
    risk: "high" as const,
  }));
}
