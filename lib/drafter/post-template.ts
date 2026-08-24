/**
 * The starting skeleton for a new post.
 *
 * Mirrors the "Blog Post Template" draft kept in the client's WordPress: the
 * same sections, in the same order, with the same emoji headings and the same
 * plugin blocks (Feast jump-to, WP Recipe Maker card, related-posts grid). A
 * new article opens with this already in place instead of the author rebuilding
 * it every time.
 *
 * Emoji mapping is the measured one from `style.ts` — 88% of published H2s open
 * with one, and it is the most visible signature of the format. The ingredients
 * heading takes a dish-specific emoji, so it is a parameter rather than fixed,
 * and the recipe-card heading deliberately carries none.
 */

export type TemplateOptions = {
  /** Post title, used in the headings that name the dish. */
  title: string;
  /** Emoji for the ingredients H2. Dish-specific in published posts. */
  ingredientsEmoji?: string;
  /** How many method steps to stub out. Published posts run to eight. */
  steps?: number;
};

const STEP_WORDS = [
  "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve",
];

/**
 * Marker meaning "the author has not filled this in yet".
 *
 * An HTML comment, so it never renders. It does *not* survive the editor:
 * ProseMirror parses the document into its own schema and comments are not
 * nodes, so the marker is gone the first time an article is saved. It is still
 * written, because a draft exported before any editing has it and it is the
 * cheapest possible check — but it is not what the export relies on.
 */
export const PLACEHOLDER = "<!-- snaily:todo -->";

/**
 * Every prompt sentence the skeleton writes.
 *
 * This is what actually keeps template prompts out of WordPress. The marker
 * above disappears on first save, and without a second signal "Hook — three or
 * four sentences" reached the live draft looking like copy. Matching the exact
 * sentence is safe in the one direction that matters: the moment an author
 * types over a prompt the text no longer matches, so their words are kept.
 */
const HINTS = new Set<string>();

function todo(hint: string): string {
  HINTS.add(normaliseHint(hint));
  return `<p>${PLACEHOLDER}<em>${hint}</em></p>`;
}

/** Bare list-item prompts, which carry no <em> wrapper. */
function todoItem(hint: string): string {
  HINTS.add(normaliseHint(hint));
  return `<li>${PLACEHOLDER}${hint}</li>`;
}

/** An unfilled heading, e.g. the first FAQ question. */
function todoHeading(hint: string): string {
  HINTS.add(normaliseHint(hint));
  return `<h3>${PLACEHOLDER}${hint}</h3>`;
}

/**
 * Comparison form for a prompt.
 *
 * The editor rewrites punctuation on its way through — the em dash in "Hook —
 * three or four sentences" comes back as a plain hyphen, entities are decoded,
 * whitespace is collapsed — so the comparison is made on letters and digits
 * alone rather than on the exact bytes.
 */
function normaliseHint(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The note that sits under the ingredients list on every published post.
 * Reproduced verbatim because it is the same sentence every time.
 */
const RECIPE_CARD_NOTE =
  "*See the recipe card at the bottom of the page for exact quantities, nutritional info, and detailed cooking directions.";

export function buildPostTemplate(options: TemplateOptions): string {
  const title = options.title.trim() || "this recipe";
  const emoji = options.ingredientsEmoji ?? "🌶️";
  const steps = Math.min(Math.max(options.steps ?? 8, 1), STEP_WORDS.length);

  const stepBlocks = Array.from({ length: steps }, (_, i) => {
    const word = STEP_WORDS[i] ?? String(i + 1);
    return [
      `<h3>Step ${word}</h3>`,
      todo(`Photo for step ${word.toLowerCase()}.`),
      todo("What happens in this step, in one or two sentences."),
    ].join("\n");
  }).join("\n\n");

  return [
    // ---- Hook and lead image: no heading, same as every published post ----
    todo("Hook — three or four sentences. No heading above this."),
    todo("Lead photo goes here."),
    todo("The rest of the intro: the story, why this version, who it is for."),

    // ---- Feast plugin's jump-to block ----
    "<!-- wp:feast/jump-to -->",
    todo(
      "Advanced Jump To — the Feast plugin fills this from the headings once the post is saved.",
    ),
    "<!-- /wp:feast/jump-to -->",

    `<h2>🥰 Why you'll adore ${title}</h2>`,
    "<ul>",
    todoItem("Vegan AF."),
    todoItem("Reason two."),
    todoItem("Reason three."),
    todoItem("What the testers said."),
    "</ul>",

    `<h2>${emoji} Ingredients for ${title}</h2>`,
    todo("Ingredients photo."),
    todo(
      "An H3 per unusual ingredient only — what it is, what to swap in. Ingredient links are added automatically in this section.",
    ),
    `<p><em>${RECIPE_CARD_NOTE}</em></p>`,

    "<h2>🤯 Variations</h2>",
    todo("Real variants only. Delete this section if the recipe has none."),

    `<h2>📖 How to make ${title}</h2>`,
    stepBlocks,

    "<h2>💡 Serving ideas</h2>",
    todo("Plating, pairings, what to do with leftovers."),

    "<h2>👉 Top tips</h2>",
    "<ol>",
    todoItem("Pitfalls only — things that actually go wrong."),
    "</ol>",

    "<h2>🤷‍♀️ Recipe FAQs</h2>",
    todoHeading("Enter a question"),
    todo("Enter the answer to the question."),

    "<h2>✌️ You'll love these too</h2>",
    todo("Four related recipes. The site renders these as a card grid."),

    // ---- WP Recipe Maker card ----
    "<h2>Recipe</h2>",
    "<!-- wp:wp-recipe-maker/recipe -->",
    `<p>${PLACEHOLDER}<em>WPRM Recipe — create or insert the recipe card in WordPress. Fill in the Recipe tab here to ship structured data with it.</em></p>`,
    "<!-- /wp:wp-recipe-maker/recipe -->",
  ].join("\n\n");
}

/**
 * The same skeleton, but with the headings the client's WordPress template
 * actually uses.
 *
 * The built-in list above is a faithful copy of that template, and a copy is
 * exactly the thing that goes stale. When the template can be read, its own
 * headings win — so renaming a section in WordPress renames it in the editor,
 * and the author never drafts against a structure the export cannot map.
 *
 * Only the H2 wording is taken across. The prompts, the step count and the
 * plugin blocks stay as they are: those describe how to *write* the post,
 * which is this app's job rather than the template's.
 */
export function applyTemplateHeadings(
  html: string,
  headings: { key: string; text: string }[],
): string {
  const byKey = new Map(headings.map((h) => [h.key, h.text]));

  const KEYS: [RegExp, string][] = [
    [/^(?:.\s*)?why you/iu, "why"],
    [/ingredient/iu, "ingredients"],
    [/variation/iu, "variations"],
    [/how to make/iu, "how-to-make"],
    [/serving/iu, "serving"],
    [/top tips?/iu, "tips"],
    [/faq/iu, "faqs"],
    [/love these/iu, "related"],
  ];

  return html.replace(/<h2>([\s\S]*?)<\/h2>/g, (whole, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    const key = KEYS.find(([re]) => re.test(text))?.[1];
    if (key === undefined) return whole;

    const replacement = byKey.get(key);
    if (replacement === undefined || replacement.trim() === "") return whole;

    /*
     * The template's heading often names no dish ("🌶️ Ingredients for"), while
     * the editor's does ("🌶️ Ingredients for Vegan Beet Hummus"). The longer
     * one is the more useful prompt, so the template only replaces a heading
     * when it says more than the generated one does.
     */
    return replacement.length > text.length
      ? `<h2>${replacement}</h2>`
      : whole;
  });
}

/*
 * `HINTS` is filled by the builders above as a side effect of writing the
 * skeleton, so it has to be primed before anything asks whether a block is a
 * prompt — the export path never calls `buildPostTemplate` itself. Built at the
 * maximum step count so every step prompt is registered.
 */
buildPostTemplate({ title: "", steps: STEP_WORDS.length });

/** Every block-level element a prompt can occupy. */
const PROMPT_BLOCK = /<(p|li|h[23])\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** True when this element is still the skeleton's own prompt, untouched. */
function isPrompt(inner: string): boolean {
  if (inner.includes(PLACEHOLDER)) return true;
  const text = normaliseHint(inner);
  return text !== "" && HINTS.has(text);
}

/** True when the draft is still mostly unfilled template. */
export function hasPlaceholders(html: string): boolean {
  return countPlaceholders(html) > 0;
}

export function countPlaceholders(html: string): number {
  let n = 0;
  for (const m of html.matchAll(PROMPT_BLOCK)) {
    if (isPrompt(m[2] ?? "")) n += 1;
  }
  return n;
}

/**
 * Strips unfilled template prompts before anything leaves the app.
 *
 * A prompt is recognised two ways: by the marker, which is present until the
 * article's first save, and by its exact wording, which is what remains after
 * the editor has dropped the comment. Shipping "Hook — three or four
 * sentences" to a WordPress draft is worse than shipping an empty section, and
 * that is exactly what happened while only the marker was checked.
 *
 * An element the author has typed into no longer matches either test, so their
 * words are never at risk.
 */
export function stripPlaceholders(html: string): string {
  return (
    html
      .replace(PROMPT_BLOCK, (whole, _tag: string, inner: string) =>
        isPrompt(inner) ? "" : whole,
      )
      // Any stray marker on an element that did survive editing.
      .split(PLACEHOLDER)
      .join("")
      // Lists left empty by the removals above.
      .replace(/<(ul|ol)>\s*<\/\1>/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
