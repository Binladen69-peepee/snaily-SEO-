/**
 * Where every number in the app comes from.
 *
 * The rule this enforces: a metric may never claim a stronger provenance than
 * its weakest input. A score built from one measured figure and one estimate is
 * an estimate. Nothing is ever invented to fill a column — a metric with no
 * legitimate source reports `unavailable` and the UI renders it as N/A.
 *
 * This replaces the older three-state model in `lib/keywords/authority.ts` by
 * adding `derived`, which is the honest label for a documented calculation over
 * real inputs — the Snaily authority scores are exactly that, and calling them
 * "estimated" undersold them while calling them "measured" would be a lie.
 */

export const PROVENANCE = ["real", "derived", "estimated", "unavailable"] as const;

export type Provenance = (typeof PROVENANCE)[number];

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  real: "Real",
  derived: "Derived",
  estimated: "Estimated",
  unavailable: "Unavailable",
};

export const PROVENANCE_NOTE: Record<Provenance, string> = {
  real: "Measured directly by a first-party API or by fetching the page.",
  derived: "Calculated from real inputs using a documented formula.",
  estimated: "Modelled from indirect signals. Treat as a rough ordering, not a measurement.",
  unavailable: "No legitimate free source supplies this. It is not guessed.",
};

/** Tailwind tone per label, so the chip looks the same everywhere. */
export const PROVENANCE_TONE: Record<Provenance, string> = {
  real: "bg-success/12 text-success",
  derived: "bg-primary/12 text-primary",
  estimated: "bg-warning/15 text-warning",
  unavailable: "bg-muted text-muted-foreground",
};

/**
 * A number with its origin attached.
 *
 * `value` is null exactly when `provenance` is "unavailable".
 */
export type Measured = {
  value: number | null;
  provenance: Provenance;
  /** Shown on hover: what this is and how it was produced. */
  note: string;
  /** The named inputs behind a derived score, so it can be argued with. */
  inputs?: { label: string; detail: string; weight?: number }[];
};

export function real(value: number, note: string): Measured {
  return { value, provenance: "real", note };
}

export function derived(
  value: number,
  note: string,
  inputs?: Measured["inputs"],
): Measured {
  return { value, provenance: "derived", note, inputs };
}

export function estimated(value: number, note: string): Measured {
  return { value, provenance: "estimated", note };
}

export function unavailable(note: string): Measured {
  return { value: null, provenance: "unavailable", note };
}

/** Ordered weakest-last, so combining provenances is a max(). */
const RANK: Record<Provenance, number> = {
  real: 0,
  derived: 1,
  estimated: 2,
  unavailable: 3,
};

/**
 * The provenance of a value computed from several others.
 *
 * Takes the weakest of its inputs — a calculation cannot be more trustworthy
 * than the least trustworthy number that went into it.
 */
export function weakest(...sources: Provenance[]): Provenance {
  if (sources.length === 0) return "unavailable";
  return sources.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst));
}

/* -------------------------------------------------------------------------
 * Standard notes for things we deliberately do not supply.
 * ---------------------------------------------------------------------- */

export const NO_THIRD_PARTY_LINKS =
  "Referring domains and backlink counts are derived from Common Crawl PageRank when the domain is in that graph. They are a sample of the web, not a live commercial backlink crawl.";

export const NO_COMPETITOR_KEYWORDS =
  "What another domain ranks for needs a domain-to-keyword database. Competitor screens report what a site targets, read from its own pages.";

export const NO_REAL_VOLUME =
  "Exact monthly search volume comes from Google Keyword Planner. Until an Ads API account is connected, demand is shown as a relative signal rather than a fabricated number.";
