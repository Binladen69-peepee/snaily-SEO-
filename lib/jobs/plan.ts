/**
 * Deciding what to write, and reading back what came out.
 *
 * Kept apart from the stages so the decisions are testable without a database
 * or a model. How a fourteen-step recipe is split across calls, and whether a
 * reply can be trusted to be the sections that were asked for, are exactly the
 * things that break quietly at three in the morning — so they are ordinary
 * functions with ordinary inputs.
 */

import { SECTION_KEYS, type SectionKey } from "@/lib/jobs/types";

export type SectionGroup = {
  id: string;
  keys: SectionKey[];
  /** Step range this call covers, when the method is split across two calls. */
  steps?: { from: number; to: number };
  maxTokens: number;
};

/** Steps beyond this many are written in two calls rather than one long one. */
export const STEPS_PER_CALL = 5;

/**
 * Groups the sections into bounded calls.
 *
 * Sections that inform each other travel together, and the method is split by
 * step count because a fourteen-step recipe is the one thing here that
 * genuinely cannot fit in a single reply.
 *
 * The introduction and "why you'll adore" used to share a call, on the grounds
 * that they repeat each other badly when written apart. They no longer do:
 * each has its own writer, and the introduction's writer forbids repeating the
 * hook explicitly. Splitting them also keeps each call inside the per-minute
 * token allowance - together they pulled three writers' worth of brief and
 * tipped a real job past the ceiling, where it yielded every few seconds
 * without ever making the call.
 */
export function planGroups(
  keys: SectionKey[],
  stepCount: number,
): SectionGroup[] {
  const has = (k: SectionKey) => keys.includes(k);
  const groups: SectionGroup[] = [];

  if (has("intro")) {
    groups.push({ id: "opening", keys: ["intro"], maxTokens: 900 });
  }
  if (has("why")) {
    groups.push({ id: "why", keys: ["why"], maxTokens: 800 });
  }

  const middle: SectionKey[] = [
    ...(has("ingredients") ? (["ingredients"] as SectionKey[]) : []),
    ...(has("variations") ? (["variations"] as SectionKey[]) : []),
  ];
  if (middle.length > 0) groups.push({ id: "ingredients", keys: middle, maxTokens: 1_200 });

  if (has("steps")) {
    if (stepCount > STEPS_PER_CALL) {
      const half = Math.ceil(stepCount / 2);
      groups.push({
        id: "steps-a",
        keys: ["steps"],
        steps: { from: 1, to: half },
        maxTokens: 1_000,
      });
      groups.push({
        id: "steps-b",
        keys: ["steps"],
        steps: { from: half + 1, to: stepCount },
        maxTokens: 1_000,
      });
    } else {
      groups.push({
        id: "steps",
        keys: ["steps"],
        steps: { from: 1, to: stepCount },
        maxTokens: 1_200,
      });
    }
  }

  /*
   * The three short closing sections share one call.
   *
   * Every call carries the same fixed freight before it writes a word: the
   * house style guide (646 tokens), the grounding constraints (528), the
   * recipe and research context (~1,200) and the task framing. Measured, that
   * is about 2,950 tokens paid per call regardless of how much is written —
   * and serving, tips and related together only produce about 500 words.
   * Writing them separately paid that freight three times to save nothing.
   *
   * Their three writers total roughly 1,400 tokens, so the merged prompt lands
   * near 4,400 against a 7,360 ceiling — comfortably inside it, where merging
   * the intro with "why" was not. That distinction is the whole reason those
   * two remain separate above.
   */
  const tail: SectionKey[] = [
    ...(has("serving") ? (["serving"] as SectionKey[]) : []),
    ...(has("tips") ? (["tips"] as SectionKey[]) : []),
    ...(has("related") ? (["related"] as SectionKey[]) : []),
  ];
  if (tail.length > 0) {
    groups.push({
      id: "closing",
      keys: tail,
      // The sum of what the three asked for alone, so none is written shorter.
      maxTokens:
        (has("serving") ? 900 : 0) + (has("tips") ? 700 : 0) + (has("related") ? 400 : 0),
    });
  }

  return groups;
}

const SECTION_DELIMITER = /<<<SECTION:([a-z-]+)>>>([\s\S]*?)(?=<<<SECTION:|<<<END>>>|$)/gi;

/** Every `<<<…>>>` marker. Broader than SECTION/END so a typo still comes off. */
const ANY_DELIMITER = /<<<[^>\n]{0,120}>>>/gi;

/**
 * Removes the section markers from a body.
 *
 * `parseSections` bounds its capture at the next marker, so a reply that
 * arrives in the expected shape never carries one through. Two paths go
 * around it: a single-section group whose reply had no delimiters at all is
 * taken whole, and the expand stage rewrites a section from a prompt that has
 * shown the model the format. Both have shipped a stray `<<<END>>>` and a
 * `<<<SECTION:ingredients>>>` into a published post — and inside a Yoast FAQ
 * answer the marker broke the block's JSON, so WordPress gave up parsing the
 * block and rendered its raw comment to the reader as visible text.
 *
 * The markers are this pipeline's own and are never legitimate prose, so they
 * come off wherever a body is stored rather than being guarded against one
 * call site at a time.
 */
export function stripDelimiters(body: string): string {
  return body
    .replace(ANY_DELIMITER, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits a multi-section reply back into its sections.
 *
 * Delimiters rather than headings, because headings are content: the model is
 * asked to write "## 🤯 Variations" and splitting on `##` would then also split
 * on every step heading inside the method. An unknown key is dropped rather
 * than guessed at.
 */
export function parseSections(raw: string): Partial<Record<SectionKey, string>> {
  const out: Partial<Record<SectionKey, string>> = {};
  for (const m of raw.matchAll(SECTION_DELIMITER)) {
    const key = (m[1] ?? "").toLowerCase() as SectionKey;
    if (!SECTION_KEYS.includes(key)) continue;
    const body = (m[2] ?? "")
      .replace(/^```(?:markdown)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const clean = stripDelimiters(body);
    if (clean !== "") out[key] = clean;
  }
  return out;
}

/**
 * Cuts a section body back to the one heading it is allowed to have.
 *
 * Each section owns exactly one H2 — that is what the outline promised and what
 * the WordPress template maps against. A model handed an example heading will
 * sometimes reproduce it as a real one: a soup post came back with both
 * "✌️ You'll also love these vegan soups" and "✌️ You'll also love these vegan
 * muffin recipes:", the second lifted word for word from the instructions.
 *
 * Rewording the prompt helps and does not settle it, because the failure is a
 * model writing one heading too many and there is no phrasing that cannot
 * happen. The structure is checkable, so it is checked: everything from the
 * second heading onward is dropped, and the intro — which carries no heading at
 * all — is cut at the first one.
 */
export function trimToOneHeading(body: string, allowHeading: boolean): string {
  const headings = [...body.matchAll(/^##\s+.*$/gm)];
  const cutAt = allowHeading ? headings[1]?.index : headings[0]?.index;
  return cutAt === undefined ? body.trim() : body.slice(0, cutAt).trim();
}

/**
 * Sections every post has. The rest are included only when they earn a place.
 *
 * Ingredients is on this list because the WordPress template has a fixed
 * ingredients H2 and the export maps prose into it. Left optional, the model
 * dropped it from a soup built on gochujang, white miso and kabocha — three
 * things a reader plausibly has never bought — and then wrote a stray
 * "Ingredients" heading into the closing section instead, because the post
 * obviously needed one.
 */
export const REQUIRED_SECTIONS: SectionKey[] = [
  "intro",
  "why",
  "ingredients",
  "steps",
  "serving",
  "tips",
  "faq",
];

/** Roughly how the site's own posts distribute their words. */
export const WORD_SHARE: Record<SectionKey, number> = {
  intro: 0.12,
  why: 0.09,
  ingredients: 0.14,
  variations: 0.11,
  steps: 0.21,
  serving: 0.15,
  tips: 0.12,
  faq: 0.1,
  related: 0.03,
};

export function parseOutlineLines(
  text: string,
): { key: SectionKey; heading: string; brief: string }[] {
  const out: { key: SectionKey; heading: string; brief: string }[] = [];
  const seen = new Set<SectionKey>();

  for (const line of text.split(/\r?\n/)) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 2) continue;

    const key = parts[0]!.toLowerCase().replace(/[^a-z]/g, "") as SectionKey;
    if (!SECTION_KEYS.includes(key) || seen.has(key)) continue;

    seen.add(key);
    out.push({
      key,
      heading: parts[1]!.replace(/^#+\s*/, "").trim(),
      brief: (parts[2] ?? "").trim(),
    });
  }

  return out;
}

/** Fallback wording when the model omitted a section the format requires. */
export function defaultHeading(key: SectionKey, title: string): string {
  const dish = title.replace(/\brecipe\b/i, "").trim() || "this";
  const map: Record<SectionKey, string> = {
    intro: "",
    why: `🥰 Why you'll adore this ${dish}`,
    ingredients: `🌶️ Ingredients for ${dish}`,
    variations: "🤯 Variations",
    steps: `📖 How to make ${dish}`,
    serving: "💡Serving Ideas",
    tips: "👉Top tips",
    faq: "🤷‍♀️ Recipe FAQs",
    related: "✌️You'll also love these:",
  };
  return map[key];
}
