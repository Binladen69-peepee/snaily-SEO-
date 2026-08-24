/**
 * Which of the post's sections a heading names.
 *
 * Pure string work, kept apart from the module that reads a template out of
 * the database. The internal-link pass needs to know which section a run of
 * HTML belongs to so it can cap how many links land there, and it has no
 * business importing a Prisma client to find out.
 */

export type SectionKey =
  | "intro"
  | "why"
  | "ingredients"
  | "variations"
  | "how-to-make"
  | "serving"
  | "tips"
  | "faqs"
  | "related"
  | "recipe";

/** Human labels, used in the export preview and the mapping report. */
export const SECTION_LABELS: Record<SectionKey, string> = {
  intro: "Intro",
  why: "Why you'll adore",
  ingredients: "Ingredients",
  variations: "Variations",
  "how-to-make": "How to make",
  serving: "Serving ideas",
  tips: "Top tips",
  faqs: "Recipe FAQs",
  related: "You'll love these too",
  recipe: "Recipe card",
};

/**
 * Emoji, variation selectors and ZWJ sequences.
 *
 * Nearly every heading on the site opens with one, and the same section is
 * written "🤯Variations " in the template and "🤯 Variations" in a post, so
 * they are stripped before any heading is classified.
 */
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

export function normaliseHeading(text: string): string {
  return text
    .replace(EMOJI, " ")
    .toLowerCase()
    .replace(/[’'`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Which section a heading names.
 *
 * Matched on wording rather than the template's `id` attributes, so the client
 * renaming a heading or adding the dish name to it does not silently break the
 * mapping. Order matters: "how to make" is tested before the bare step check,
 * and the recipe-card heading last because "recipe" appears inside "Recipe FAQs".
 */
export function classifyHeading(raw: string): SectionKey | null {
  const t = normaliseHeading(raw);
  if (t === "") return null;

  if (/\bfaq/.test(t) || /questions?\b/.test(t)) return "faqs";
  if (/\bwhy\b/.test(t) && /(adore|love|like)\b/.test(t)) return "why";
  if (/\bingredient/.test(t)) return "ingredients";
  if (/\bvariation|other .* you might dig/.test(t)) return "variations";
  if (/how to make|\bmethod\b|\binstructions\b|step by step/.test(t)) {
    return "how-to-make";
  }
  if (/serving|serve (it|them) with|what to serve/.test(t)) return "serving";
  if (/\btips?\b/.test(t)) return "tips";
  if (/love these|also love|you might also|more recipes|related/.test(t)) {
    return "related";
  }
  if (/^recipe$|\brecipe card\b|recipe$/.test(t)) return "recipe";
  return null;
}
