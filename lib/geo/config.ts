/**
 * GEO Lab vocabulary.
 *
 * The moment definitions are quoted verbatim from the build spec and are fed
 * to the classifier as the rubric — the spec is explicit that the model must
 * not reinterpret them, so they live here as constants rather than being
 * paraphrased into a prompt string somewhere.
 */

export const MOMENTS = [
  {
    id: "want_to_know",
    label: "Want to Know",
    definition:
      "researching, no immediate action intended. (\"How does vegan catering pricing usually work?\")",
  },
  {
    id: "want_to_go",
    label: "Want to Go",
    definition:
      "looking for a place/provider, often locally bound. (\"Vegan caterer near Hoboken,\" \"vegan food truck for a backyard event in Bucks County.\")",
  },
  {
    id: "want_to_do",
    label: "Want to Do",
    definition:
      "trying to solve a specific problem or complete a task. (\"How do I plan a menu when half my wedding guests are vegan and half aren't?\")",
  },
  {
    id: "want_to_buy",
    label: "Want to Buy",
    definition:
      "ready to decide, comparing specifics. (\"Vegan wedding catering cost for 80 guests in NJ.\")",
  },
] as const;

export type MomentId = (typeof MOMENTS)[number]["id"];

export const MOMENT_LABEL: Record<string, string> = Object.fromEntries(
  MOMENTS.map((m) => [m.id, m.label]),
);

/**
 * The six trust-content categories. The spec calls these "the single
 * highest-leverage piece of this build" and says to adapt these rather than
 * invent new ones per run — so the list is fixed.
 */
export const TRUST_CATEGORIES = [
  {
    id: "pricing",
    label: "Pricing / What It Actually Costs",
    brief:
      "Real cost logic — what drives a quote up or down. Never a fabricated number; write the logic transparently instead.",
  },
  {
    id: "problems",
    label: "Problems / What Goes Wrong",
    brief:
      "Honest event-planning pitfalls. Doubt-resolution content demonstrates expertise without selling.",
  },
  {
    id: "not_a_fit",
    label: "Not a Fit",
    brief:
      "When someone genuinely does not need this service. Reads as trustworthy precisely because it is anti-sales.",
  },
  {
    id: "comparison",
    label: "Comparison / Which Option Fits Your Day",
    brief:
      "Weighing one real option against another, including cross-links between service lines.",
  },
  {
    id: "how_to",
    label: "How-To / Process Transparency",
    brief:
      "What actually happens, step by step. Serves Want to Do and Want to Know.",
  },
  {
    id: "local_logistics",
    label: "Local Logistics",
    brief:
      "Genuinely specific regional detail built from real facts — not filler state-name repetition.",
  },
] as const;

export type TrustCategoryId = (typeof TRUST_CATEGORIES)[number]["id"];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  TRUST_CATEGORIES.map((c) => [c.id, c.label]),
);

export type AnchorPage = { id: string; label: string; url: string };

/**
 * Starting anchor pages.
 *
 * The spec wants these "pulled dynamically from a short config list Adam/you
 * maintain inside Settings", so these are only the seed values written into a
 * project's Business Facts the first time it is opened — after that they are
 * edited in the panel, not here.
 */
export const DEFAULT_ANCHOR_PAGES: AnchorPage[] = [
  { id: "catering", label: "Catering (NJ/NY/PA + travel)", url: "" },
  { id: "consulting", label: "Culinary Consulting", url: "" },
  { id: "megastallion", label: "Galactic MegaStallion (pop-ups / cart)", url: "" },
  { id: "brand", label: "Other / general brand", url: "" },
];

export function parseAnchorPages(value: unknown): AnchorPage[] {
  if (!Array.isArray(value)) return DEFAULT_ANCHOR_PAGES;
  const rows: AnchorPage[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const o = v as { id?: unknown; label?: unknown; url?: unknown };
    if (typeof o.id !== "string" || o.id.trim() === "") continue;
    if (typeof o.label !== "string" || o.label.trim() === "") continue;
    rows.push({
      id: o.id,
      label: o.label,
      url: typeof o.url === "string" ? o.url : "",
    });
  }
  return rows.length > 0 ? rows : DEFAULT_ANCHOR_PAGES;
}

/** Rubric text handed to the classifier, built from the constants above. */
export function momentRubric(): string {
  return MOMENTS.map((m) => `- ${m.label} — ${m.definition}`).join("\n");
}

export function categoryRubric(): string {
  return TRUST_CATEGORIES.map((c) => `- ${c.label} (id: ${c.id}) — ${c.brief}`).join(
    "\n",
  );
}
