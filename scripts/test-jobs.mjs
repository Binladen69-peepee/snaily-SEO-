/**
 * The Drafter pipeline's decisions, tested without a database or a model.
 *
 * Everything here is a pure function on purpose: how a recipe paste is split,
 * how a long method is spread across calls, whether a reply can be trusted,
 * and whether a proofread that mangled a link is caught. Those are the parts
 * that fail silently in production — a dropped anchor or a section filed under
 * the wrong key looks exactly like a model having an off day.
 *
 *   node scripts/test-jobs.mjs
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

/*
 * These checks are pure functions, but one compiled module in the graph
 * (style-brief) imports the Prisma client, which validates its connection
 * string at import time. Nothing here ever opens a connection - the URL only
 * has to parse, so the suite stays runnable with no database and no .env.
 */
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".jobtest-"));

const SOURCES = [
  "lib/ai-policy.ts",
  "lib/drafter/recipe-paste.ts",
  "lib/drafter/readability.ts",
  "lib/drafter/tighten.ts",
  "lib/drafter/steps.ts",
  "lib/drafter/specialty.ts",
  "lib/drafter/quality-gate.ts",
  "lib/drafter/style-brief.ts",
  "lib/db.ts",
  "lib/markdown.ts",
  "lib/content/html-runs.ts",
  "lib/content/internal-links.ts",
  "lib/wordpress/sections.ts",
  "lib/jobs/types.ts",
  "lib/jobs/plan.ts",
  "lib/text.ts",
  "lib/jobs/compose.ts",
  "lib/jobs/token-window.ts",
  "lib/jobs/kick.ts",
];

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: false,
      skipLibCheck: true,
      types: ["node"],
      baseUrl: ROOT,
      paths: { "@/*": ["./*"] },
      outDir: out,
      rootDir: ROOT,
    },
    files: SOURCES.map((s) => join(ROOT, s)),
  }),
);

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

try {
  execFileSync("npx", ["tsc", "-p", `"${join(out, "tsconfig.json")}"`], {
    stdio: "pipe",
    shell: true,
  });
} catch (err) {
  console.error("tsc failed:\n" + String(err.stdout ?? err));
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

/*
 * The compiled files import each other by "@/..." — rewrite to relative paths.
 *
 * Every emitted file, not just the listed sources: tsc also emits whatever
 * they import, and a transitive module left with a bare "@/lib/..." specifier
 * fails at import time with an error that names a package nobody installed.
 */
const emitted = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) emitted.push(full);
  }
};
walk(out);

for (const file of emitted) {
  const rel = relative(out, file).split(sep).join("/");
  const prefix = "../".repeat(rel.split("/").length - 1) || "./";
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      /from "@\/(.*?)"/g,
      (_m, r) => `from "${prefix}${r}.js"`,
    ),
  );
}

const load = (f) => import(pathToFileURL(join(out, f)).href);

const { parseRecipePaste, validateRecipePaste, formatSteps } = await load(
  "lib/drafter/recipe-paste.js",
);
const {
  planGroups,
  parseSections,
  parseOutlineLines,
  defaultHeading,
  trimToOneHeading,
  stripDelimiters,
} = await load("lib/jobs/plan.js");
const { extractQuestions } = await load("lib/text.js");
const { normaliseStepHeadings, stepLabel } = await load("lib/drafter/steps.js");
const { selectSpecialtyIngredients, ingredientName } = await load(
  "lib/drafter/specialty.js",
);
const {
  composeMarkdown,
  composeHtml,
  maskAnchors,
  unmaskAnchors,
  chunkByHeading,
  stripPlaceholderBlocks,
  proseWords,
} = await load("lib/jobs/compose.js");
const { insertInternalLinks, findRawLinkArtifacts } = await load(
  "lib/content/internal-links.js",
);
const { measureStyle, formatStyleBrief } = await load(
  "lib/drafter/style-brief.js",
);
const { fitMaxTokens, clip } = await load("lib/ai-policy.js");
const { TokenWindow } = await load("lib/jobs/token-window.js");
const { selfOrigin, jobToken, verifyJobToken } = await load("lib/jobs/kick.js");

try {
  /* ---------------------------------------------------------------- */
  console.log("\nRecipe paste");

  const sectioned = parseRecipePaste(
    [
      "Ingredients",
      "2 cups (480 ml) coconut milk",
      "1 tablespoon gochujang",
      "½ teaspoon smoked salt",
      "",
      "Instructions",
      "1. Warm the coconut milk over medium heat until it steams.",
      "2. Whisk in the gochujang and simmer for 18 minutes.",
      "3. Season with the smoked salt and serve.",
    ].join("\n"),
  );

  check(sectioned.ingredients.length === 3, "explicit headings split ingredients");
  check(sectioned.steps.length === 3, "explicit headings split steps");
  check(sectioned.sectioned === true, "sectioned paste is flagged");
  check(
    sectioned.steps[1].includes("18 minutes"),
    "the author's own cook time survives verbatim",
  );
  check(
    formatSteps(sectioned).startsWith("1. Warm"),
    "steps are numbered for the writing prompt",
  );

  const unheaded = parseRecipePaste(
    [
      "3 tablespoons olive oil",
      "1 large onion, diced",
      "Heat the oil in a large pan and cook the onion until it turns golden.",
      "Add the tomatoes and simmer for 25 minutes, stirring now and then.",
    ].join("\n"),
  );
  check(unheaded.ingredients.length === 2, "quantity-led lines read as ingredients");
  check(unheaded.steps.length === 2, "sentences read as steps");

  check(
    validateRecipePaste(parseRecipePaste("just some words")).some(
      (i) => i.code === "no-ingredients",
    ),
    "a paste with no ingredients is refused",
  );
  check(
    validateRecipePaste(sectioned).length === 0,
    "a usable paste raises nothing",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nCall planning");

  const allKeys = [
    "intro",
    "why",
    "ingredients",
    "variations",
    "steps",
    "serving",
    "tips",
    "related",
  ];

  const short = planGroups(allKeys, 4);
  check(short.length === 7, "a short recipe plans seven calls");
  check(
    short.every((g) => g.maxTokens <= 1_300),
    "no single call asks for more than 1,300 tokens",
  );
  /*
   * The introduction and "why you'll adore" are written separately. Together
   * they pulled three section writers' worth of brief into one prompt, which
   * put a real job past the per-minute token allowance - where it yielded
   * every few seconds forever without making the call.
   */
  check(
    short.filter((g) => g.keys.includes("intro")).length === 1 &&
      short.filter((g) => g.keys.includes("why")).length === 1 &&
      !short.some((g) => g.keys.includes("intro") && g.keys.includes("why")),
    "the intro and the why section are written in separate calls",
  );

  const long = planGroups(allKeys, 14);
  check(long.length === 8, "a fourteen-step method adds another call");
  const stepGroups = long.filter((g) => g.steps !== undefined);
  check(stepGroups.length === 2, "the method is split in two");
  check(
    stepGroups[0].steps.from === 1 && stepGroups[0].steps.to === 7,
    "first half covers steps 1-7",
  );
  check(
    stepGroups[1].steps.from === 8 && stepGroups[1].steps.to === 14,
    "second half covers steps 8-14 with no gap and no overlap",
  );

  const minimal = planGroups(["intro", "why", "steps", "serving", "tips"], 3);
  check(
    minimal.every((g) => !g.keys.includes("ingredients")),
    "a section the outline dropped is never written",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nReading the model back");

  const reply = [
    "<<<SECTION:intro>>>",
    "This gochujang soup is the one I make when it is raining.",
    "<<<SECTION:why>>>",
    "## 🥰 Why you'll adore this soup",
    "- **Vegan AF:** no fish sauce, no anchovy, none of it.",
    "<<<END>>>",
  ].join("\n");

  const parsedReply = parseSections(reply);
  check(Object.keys(parsedReply).length === 2, "both sections come back");
  check(
    parsedReply.intro.startsWith("This gochujang"),
    "intro body is the intro body",
  );
  check(
    !parsedReply.why.includes("<<<"),
    "delimiters do not leak into the prose",
  );
  check(
    Object.keys(parseSections("<<<SECTION:nonsense>>>hi<<<END>>>")).length === 0,
    "an unknown section key is dropped rather than guessed",
  );
  check(
    Object.keys(parseSections("Sure! Here is your article.")).length === 0,
    "a reply with no delimiters parses as nothing, so the caller can decide",
  );

  /* ---- Markers never reach the prose ------------------------------- */

  // The shape the expand stage actually stored on the Kabocha Squash Soup run:
  // a real section body with the reply's own framing welded onto the end.
  const expanded = [
    "## \u270c\ufe0fYou'll also love these vegan soups",
    "",
    "- Easy vegan tofu chili recipe",
    "<<<END>>>",
    "",
    "<<<SECTION:ingredients>>>",
  ].join("\n");
  const strippedBody = stripDelimiters(expanded);
  check(!strippedBody.includes("<<<"), "expanded sections lose their delimiters");
  check(
    strippedBody.endsWith("- Easy vegan tofu chili recipe"),
    "and keep every word of the real body",
  );
  check(
    stripDelimiters("answer text\n\n<<<SECTION:related>>>") === "answer text",
    "a marker welded onto an FAQ answer comes off with its blank line",
  );
  check(
    stripDelimiters("nothing to strip here") === "nothing to strip here",
    "a clean body is returned unchanged",
  );
  check(
    !stripDelimiters("soup <<<DEBUG:stage>>> leftover").includes("<<<"),
    "any <<<…>>> marker comes off, not only SECTION/END",
  );

  /* ---- Links spread across the post -------------------------------- */

  const siteTitles = [
    "Vegan Miso Ramen",
    "Vegan Kimchi Fried Rice",
    "Vegan Banh Mi",
    "Vegan Corn Chowder",
    "Vegan Tofu Chili",
    "Vegan Butternut Squash Soup",
    "Vegan Sticky Rice",
    "Vegan Spring Rolls",
    "Vegan Peanut Sauce",
    "Vegan Cornbread",
  ];
  const siteIndex = {
    all: siteTitles.map((title, i) => ({
      title,
      url: `https://example.com/${title.toLowerCase().replaceAll(" ", "-")}/`,
      slug: title.toLowerCase().replaceAll(" ", "-"),
      wpId: 100 + i,
      type: "post",
      terms: title.toLowerCase().split(" "),
    })),
    bySlug: new Map(),
    byTitle: new Map(),
  };

  // Every section names a sibling, which is what the rewritten prompts ask for.
  const namesEverywhere = [
    "<p>A soup that eats like vegan miso ramen and vegan kimchi fried rice and vegan banh mi.</p>",
    "<h2>🥰 Why you'll adore this soup</h2>",
    "<p>Like all my vegan corn chowder and vegan tofu chili and vegan sticky rice.</p>",
    "<h2>💡Serving Ideas</h2>",
    "<p>Serve with vegan spring rolls, vegan peanut sauce, vegan cornbread,",
    "vegan butternut squash soup, vegan miso ramen and vegan banh mi.</p>",
    "<h2>🤷‍♀️ Recipe FAQs</h2>",
    "<p>Swap it for vegan tofu chili or vegan corn chowder if you like.</p>",
    "<h2>Recipe</h2>",
    "<p>vegan cornbread vegan peanut sauce</p>",
  ].join("\n");

  const spread = insertInternalLinks(namesEverywhere, siteIndex);

  const linksIn = (heading) => {
    const parts = spread.html.split(/(?=<h2)/i);
    const part =
      heading === null
        ? parts[0]
        : parts.find((p) => p.includes(heading)) ?? "";
    return (part.match(/<a\b[^>]*href=/gi) ?? []).length;
  };

  check(linksIn(null) > 0 && linksIn(null) <= 3, "the intro carries 1-3 links");
  check(linksIn("Why you'll adore") <= 2, "the why section is capped at two");
  check(linksIn("Serving Ideas") <= 8, "serving ideas may carry the most");
  check(linksIn("Recipe FAQs") <= 1, "the FAQ carries at most one");
  check(linksIn("<h2>Recipe</h2>") === 0, "the recipe card is never linked into");
  check(
    new Set(spread.inserted.map((i) => i.url)).size === spread.inserted.length,
    "no post is linked twice in one article",
  );
  check(
    spread.inserted.length >= 6,
    "and the post still gets a real number of links overall",
  );

  /* ---- Which ingredients earn a paragraph --------------------------- */

  check(
    ingredientName("1 1/4 cups shredded vegan cheddar, at room temperature") ===
      "shredded vegan cheddar",
    "the amount, the unit and the prep note come off the ingredient name",
  );
  check(
    ingredientName("3 lb. Kabocha squash, seeded and diced") === "kabocha squash",
    "an abbreviated unit with a full stop is handled too",
  );

  // The exact list from the Kabocha Squash Soup run, which came back with a
  // sub-block per line - including one about celery.
  const kabocha = [
    "2 tablespoons toasted sesame oil",
    "2 cups onion, diced",
    "2 cups celery, diced",
    "1 tablespoon ginger, grated",
    "6 cloves garlic, peeled",
    "2 teaspoons 5-spice",
    "3 lb. Kabocha squash, seeded and diced",
    "1 russet potato, peeled and quartered",
    "2 tablespoons maple syrup",
    "4 cups unsalted vegetable stock",
    "15 oz. coconut milk, full fat",
    "4 teaspoons miso paste",
    "2 tablespoons gochujang",
    "2 tablespoons maple syrup",
    "8 red jujube dates, sliced and rehydrated",
  ];
  const picked = selectSpecialtyIngredients(kabocha);
  const names = picked.map((p) => p.name);

  check(picked.length <= 6, "the section is capped at six sub-blocks");
  check(
    !names.includes("celery") && !names.includes("onion") && !names.includes("garlic"),
    "pantry staples are not explained to the reader",
  );
  check(
    names.includes("gochujang") && names.includes("kabocha squash"),
    "the items a reader might not have bought before are chosen",
  );
  check(
    names.includes("miso paste") && names.includes("red jujube dates"),
    "and so are the rest of the unusual ones",
  );
  check(
    names.includes("5-spice"),
    "a number that belongs to the name is not mistaken for an amount",
  );
  check(
    !names.includes("russet potato") && !names.includes("unsalted vegetable stock"),
    "a pantry staple wearing an adjective is still a pantry staple",
  );
  check(
    new Set(names).size === names.length,
    "an ingredient listed twice is written about once",
  );
  check(
    picked.every((p, i) => i === 0 || kabocha.indexOf(p.line) > kabocha.indexOf(picked[i - 1].line)),
    "the picks keep the recipe's own order",
  );

  /* ---- The method's three-part shape -------------------------------- */

  check(stepLabel(0) === "Step One", "steps are numbered in words");
  check(stepLabel(12) === "Step Thirteen", "including well past ten");
  check(stepLabel(40) === "Step 41", "and fall back to a digit rather than break");

  // What the Kabocha Squash Soup draft actually produced.
  const welded = [
    "### Step One - Sizzling Beginnings",
    "",
    "Heat the toasted sesame oil in a large pot over medium heat.",
    "",
    "### Step Two: Squash Goals",
    "",
    "Add the kabocha and cook for 8 minutes.",
  ].join("\n");
  const shaped = normaliseStepHeadings(welded);

  check(
    shaped.includes("### Step One\n\n**Sizzling Beginnings:**"),
    "the pun leaves the heading and becomes a bold paragraph with a colon",
  );
  check(
    !/^###.*[-:].*$/m.test(shaped),
    "no heading keeps a dash or a colon after it",
  );
  check(
    shaped.includes("### Step Two\n\n**Squash Goals:**"),
    "a colon-separated heading is split the same way as a dashed one",
  );
  check(
    shaped.includes("Heat the toasted sesame oil"),
    "the instruction itself is left exactly as written",
  );

  const alreadyRight = [
    "### Step One",
    "",
    "**Pour-ever Young:**",
    "",
    "Pour in the stock.",
  ].join("\n");
  check(
    normaliseStepHeadings(alreadyRight) === alreadyRight,
    "a method already in the right shape is not rewritten",
  );

  const misnumbered = ["### Step Four", "", "Do the thing.", "", "### Step Nine", "", "Do the other."].join("\n");
  const renumbered = normaliseStepHeadings(misnumbered);
  check(
    renumbered.includes("### Step One") && renumbered.includes("### Step Two"),
    "numbering comes from document order, not from what the model counted to",
  );

  /* ---- Questions are questions ------------------------------------- */

  const mined = extractQuestions([
    "Do not let the soup boil. Simmer it gently instead.",
    "What is kabocha squash? It is a Japanese pumpkin.",
    "What is kabocha squash? Sweet and nutty.",
    "Can I freeze this soup? Yes, for up to 3 months.",
  ]);
  check(
    !mined.some((q) => q.includes(".?")),
    "a full stop never gets a question mark stapled to it",
  );
  check(
    !mined.some((q) => /^Do not/i.test(q)),
    "an imperative starting with a question word is not mined as a question",
  );
  check(
    mined.some((q) => q === "What is kabocha squash?"),
    "a genuine question survives with exactly one question mark",
  );
  check(
    mined.some((q) => q === "Can I freeze this soup?"),
    "an auxiliary-opening sentence counts when it is punctuated as a question",
  );

  const outlineLines = parseOutlineLines(
    [
      "intro |  | the hook and the story",
      "why | 🥰 Why you'll adore this soup | five reasons",
      "bogus | Nope | should be ignored",
      "steps | 📖 How to make gochujang soup | eight steps",
    ].join("\n"),
  );
  check(outlineLines.length === 3, "unknown outline keys are discarded");
  check(outlineLines[1].heading.startsWith("🥰"), "emoji headings survive parsing");
  check(
    defaultHeading("tips", "Vegan Gochujang Soup Recipe") === "👉Top tips",
    "the fallback heading is the house wording, not a generic one",
  );

  const strayed = [
    "## ✌️You'll also love these vegan soups",
    "",
    "Miso Ramen",
    "",
    "## ✌️You'll also love these vegan muffin recipes:",
    "",
    "Blueberry Muffins",
  ].join("\n");
  const trimmedStray = trimToOneHeading(strayed, true);
  check(
    (trimmedStray.match(/^##/gm) ?? []).length === 1,
    "a section that wrote two headings is cut back to one",
  );
  check(
    trimmedStray.includes("Miso Ramen") && !trimmedStray.includes("Blueberry"),
    "the real section is kept and the copied example is dropped",
  );
  check(
    trimToOneHeading("Just the hook.\n\n## Stray\n\nnope", false) === "Just the hook.",
    "the intro is cut at its first heading, because it should have none",
  );
  check(
    trimToOneHeading("## 👉Top tips\n\nOnly one heading here.", true).includes("Only one"),
    "a well-formed section is left exactly as written",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nComposition");

  const state = {
    version: 1,
    outline: {
      title: "Vegan Gochujang Soup",
      targetWords: 1800,
      sections: [
        { key: "intro", heading: "", brief: "", targetWords: 200 },
        { key: "steps", heading: "📖 How to make it", brief: "", targetWords: 400 },
        { key: "faq", heading: "🤷‍♀️ Recipe FAQs", brief: "", targetWords: 200 },
        { key: "related", heading: "✌️You'll also love these:", brief: "", targetWords: 60 },
      ],
    },
    sections: {
      intro: "This soup is the one I make when it is raining.",
      steps: "## 📖 How to make it\n\n### Step One\n\nWarm the coconut milk.",
      related: "## ✌️You'll also love these:\n\nMiso Ramen",
    },
    faq: [{ question: "Can I freeze it?", answer: "Yes, for up to three months." }],
  };

  const md = composeMarkdown(state);
  check(!md.startsWith("##"), "the intro carries no heading");
  check(md.includes("Can I freeze it?"), "the FAQ is composed in");
  check(
    md.indexOf("Can I freeze it?") < md.indexOf("You'll also love"),
    "the FAQ sits before the closing list, as the site orders it",
  );
  check(
    (md.match(/## 📖 How to make it/g) ?? []).length === 1,
    "a section that already wrote its own heading does not get a second one",
  );

  check(
    md.includes("### Can I freeze it?"),
    "FAQ questions are H3s, which is what the WordPress FAQ block is built from",
  );

  const html = composeHtml(state);
  check(html.includes("<h2"), "composition produces real headings");
  check(
    /<h3[^>]*>Can I freeze it\?<\/h3>/.test(html),
    "and survive as H3 elements through the HTML conversion",
  );
  check(proseWords(html) > 10, "prose words are counted outside the headings");

  /* ---------------------------------------------------------------- */
  console.log("\nLink safety through proofreading");

  const linked =
    '<p>Serve it with <a href="https://cinnamonsnail.com/kimchi/">quick kimchi</a> and rice.</p>';
  const masked = maskAnchors(linked);
  check(!masked.text.includes("href"), "the model never sees a URL");
  check(masked.text.includes("⟦0⟧quick kimchi⟦/0⟧"), "the anchor text stays visible");

  const restored = unmaskAnchors(masked.text.replace("rice", "steamed rice"), masked.hrefs);
  check(
    restored.includes('href="https://cinnamonsnail.com/kimchi/"'),
    "a clean proofread restores the exact URL",
  );
  check(restored.includes("steamed rice"), "the correction is kept");

  check(
    unmaskAnchors("<p>Serve it with quick kimchi and rice.</p>", masked.hrefs) === null,
    "a proofread that dropped the markers is rejected, not silently accepted",
  );
  check(
    unmaskAnchors(masked.text + "⟦7⟧stray⟦/7⟧", masked.hrefs) === null,
    "an invented marker is rejected too",
  );

  const doc =
    "<p>Intro</p>" +
    "<h2>One</h2><p>" + "word ".repeat(400) + "</p>" +
    "<h2>Two</h2><p>" + "word ".repeat(400) + "</p>";
  const chunks = chunkByHeading(doc, 1_200);
  check(chunks.length >= 2, "a long document is chunked");
  check(chunks.join("") === doc, "chunking loses nothing");
  check(
    chunks.slice(1).every((c) => c.trim().startsWith("<h2")),
    "chunks break on section boundaries",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nInternal links");

  const index = {
    bySlug: new Map(),
    byTitle: new Map(),
    all: [
      {
        title: "Vegan Kimchi Fried Rice",
        url: "https://cinnamonsnail.com/vegan-kimchi-fried-rice/",
        slug: "vegan-kimchi-fried-rice",
        wpId: 1,
        type: "post",
        terms: ["vegan", "kimchi", "fried", "rice"],
      },
      {
        title: "Miso Ramen",
        url: "https://cinnamonsnail.com/miso-ramen/",
        slug: "miso-ramen",
        wpId: 2,
        type: "post",
        terms: ["miso", "ramen"],
      },
    ],
  };

  const body =
    "<h2>💡Serving Ideas</h2><p>Serve it beside Vegan Kimchi Fried Rice, or make Miso Ramen the same week.</p>";
  const inserted = insertInternalLinks(body, index);
  check(inserted.inserted.length === 2, "both real recipes are linked");
  check(
    inserted.html.includes('href="https://cinnamonsnail.com/miso-ramen/"'),
    "the anchor points at the real permalink",
  );
  check(
    !/<a[^>]*>[^<]*<a/.test(inserted.html),
    "no anchor is nested inside another",
  );

  const twice = insertInternalLinks(inserted.html, index);
  check(
    twice.inserted.length === 0,
    "running the pass twice does not double-link anything",
  );

  const headingOnly = insertInternalLinks(
    "<h2>Miso Ramen</h2><p>Nothing to link here.</p>",
    index,
  );
  check(
    headingOnly.inserted.length === 0,
    "headings are never turned into links",
  );

  const inCard = insertInternalLinks(
    "<h2>Recipe</h2><p>Miso Ramen</p>",
    index,
  );
  check(inCard.inserted.length === 0, "the recipe card is left alone");

  check(
    findRawLinkArtifacts("<p>Try [this one](/vegan-donuts/) too.</p>").length === 1,
    "leftover Markdown link syntax is caught",
  );
  check(
    findRawLinkArtifacts("<p>See https://example.com/thing for more.</p>").length === 1,
    "a raw URL in prose is caught",
  );
  check(
    findRawLinkArtifacts(inserted.html).length === 0,
    "a properly linked document is clean",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nPlaceholders");

  const dirty =
    "<p>Real prose about soup.</p>" +
    "<p>![Image of kabocha squash soup]</p>" +
    "<p>[insert the serving section here]</p>" +
    "<p>We wrote a TODO list for the shoot, which is a real sentence.</p>";
  const cleaned = stripPlaceholderBlocks(dirty);
  check(cleaned.removed === 2, "both placeholder blocks are removed");
  check(
    cleaned.html.includes("Real prose about soup"),
    "prose is untouched",
  );
  check(
    cleaned.html.includes("TODO list for the shoot"),
    "a sentence that merely mentions TODO is not deleted",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nStyle measurement");

  const measured = measureStyle(
    [
      {
        title: "Vegan Gochujang Soup",
        publishedAt: "2026-08-01T00:00:00.000Z",
        excerpt:
          "This soup slaps. It is the one I make when the weather turns and I cannot be bothered with anything complicated at all. The gochujang does the work here, and the coconut milk keeps it from taking your head off completely.",
      },
    ],
    ["🥰 Why you'll adore this", "📖 How to make it", "Recipe"],
  );
  check(measured.posts === 1, "the sample count is reported");
  check(
    Math.round(measured.emojiHeadingShare * 100) === 67,
    "emoji-led H2 share is measured, not assumed",
  );
  check(measured.meanSentenceWords > 0, "sentence length is measured");

  const brief = formatStyleBrief(measured);
  check(brief.length < 900, "the style brief stays compact");
  check(brief.includes("67%"), "the brief carries the measurement");
  check(
    formatStyleBrief(measureStyle([], [])).startsWith("VOICE REFERENCE: unavailable"),
    "an unsynced site is reported as unavailable, not invented",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nToken budget");

  process.env.AI_TPM_BUDGET = "8000";
  process.env.AI_MAX_OUTPUT_TOKENS = "3000";

  check(fitMaxTokens("short", "short", 1_000) === 1_000, "a small prompt gets what it asked for");
  check(
    fitMaxTokens("x".repeat(11_000), "y".repeat(11_000), 3_000) < 3_000,
    "a big prompt shrinks the reply rather than overflowing",
  );
  check(
    fitMaxTokens("x".repeat(40_000), "y".repeat(40_000), 3_000) === 0,
    "a prompt that cannot fit at all reports zero instead of a doomed request",
  );
  check(
    fitMaxTokens("s", "u", 99_999) === 3_000,
    "the output ceiling is honoured even when a stage asks for more",
  );
  check(clip("a".repeat(100), 20).includes("[truncated]"), "clipping is marked");

  /* ---------------------------------------------------------------- */
  console.log("\nReaching ourselves");

  const asRequest = (headers) =>
    new Request("https://example.test/api/articles", { headers });

  delete process.env.NEXT_PUBLIC_APP_URL;
  process.env.VERCEL_URL = "app-abc123-team.vercel.app";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "app.vercel.app";

  /*
   * The ordering that matters. The deployment URL in VERCEL_URL sits behind
   * Vercel Authentication on a protected project and answers a loopback call
   * with a redirect to an SSO login — so the host the request actually arrived
   * on wins, because its reachability is a demonstrated fact rather than an
   * assumption.
   */
  check(
    selfOrigin(
      asRequest({ host: "app.vercel.app", "x-forwarded-proto": "https" }),
    ) === "https://app.vercel.app",
    "the host that served the request is preferred over VERCEL_URL",
  );
  check(
    selfOrigin(
      asRequest({
        host: "internal",
        "x-forwarded-host": "www.example.com",
        "x-forwarded-proto": "https",
      }),
    ) === "https://www.example.com",
    "a forwarded host wins over the raw one",
  );
  check(
    selfOrigin(
      asRequest({
        host: "internal",
        "x-forwarded-host": "www.example.com, edge.internal",
        "x-forwarded-proto": "https, http",
      }),
    ) === "https://www.example.com",
    "and only the first hop of a forwarded chain is used",
  );
  check(
    selfOrigin(asRequest({ host: "localhost:3000" })) === "http://localhost:3000",
    "localhost is assumed to be plain http",
  );
  check(
    selfOrigin() === "https://app.vercel.app",
    "with no request, the stable production domain beats the deployment URL",
  );

  process.env.NEXT_PUBLIC_APP_URL = "https://configured.example/";
  check(
    selfOrigin(asRequest({ host: "app.vercel.app" })) === "https://configured.example",
    "an explicit override beats everything, trailing slash trimmed",
  );
  delete process.env.NEXT_PUBLIC_APP_URL;

  process.env.AUTH_SECRET = "test-secret-for-job-tokens";
  const good = await jobToken("job-one");
  check(await verifyJobToken("job-one", good), "a job token verifies for its own job");
  check(
    !(await verifyJobToken("job-two", good)),
    "and is useless for any other job",
  );
  check(!(await verifyJobToken("job-one", "")), "an empty token is refused");
  check(
    !(await verifyJobToken("job-one", "0".repeat(good.length))),
    "and so is a forged one of the right length",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nPer-minute allowance");

  const t0 = 1_000_000;
  let win = new TokenWindow({ startedAt: null, tokens: 0 }, t0);

  check(win.remaining(t0) === 7_200, "a fresh minute has 90% of the budget to spend");
  check(win.roomFor(3_000, t0), "a call that fits is allowed");

  win.record(3_000, t0);
  win.record(3_000, t0 + 5_000);
  check(
    !win.roomFor(3_000, t0 + 6_000),
    "a call that would break the limit is refused before it is made",
  );
  check(
    win.resetInMs(t0 + 6_000) === 54_000,
    "and the caller is told exactly how long to wait",
  );

  check(
    win.roomFor(3_000, t0 + 61_000),
    "the allowance returns when the minute rolls over",
  );
  check(
    win.remaining(t0 + 61_000) === 7_200,
    "and the window resets to a full budget",
  );

  /*
   * The property the whole mechanism exists for: two workers, one job, one
   * minute. The second picks up the first one's spend from the persisted
   * window instead of starting from zero and collecting the 429.
   */
  const persisted = new TokenWindow({ startedAt: null, tokens: 0 }, t0);
  persisted.record(6_000, t0);
  const successor = new TokenWindow(persisted.toState(), t0 + 10_000);
  check(
    !successor.roomFor(3_000, t0 + 10_000),
    "a second worker inherits what the first already spent this minute",
  );
  check(
    successor.roomFor(1_000, t0 + 10_000),
    "and can still spend what is genuinely left",
  );

  const stale = new TokenWindow(
    { startedAt: new Date(t0), tokens: 7_000 },
    t0 + 120_000,
  );
  check(
    stale.remaining(t0 + 120_000) === 7_200,
    "a window from two minutes ago is not held against the current one",
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(
  failures === 0 ? "\nAll job pipeline checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
