/**
 * The document format the client's own recipes are written in.
 *
 * His Vegan Lasagna, Jackfruit Enchiladas and Torta de Milanesa drafts all
 * carry the same four things in the same order: the article, the way out to
 * four other recipes, the recipe card, and the Yoast block. Everything after
 * the prose is what somebody has to retype into WordPress if it is not there.
 *
 * Two of those four were being generated correctly and then thrown away.
 * lib/drafter/document-sections.ts rendered the recipe card and the SEO block
 * and nothing in the pipeline ever called it, so the document the author read
 * ended at the last paragraph — no yield, no times, no meta description. And
 * the related section named recipes while the exporter quietly turned them
 * into a grid of post IDs the author never saw.
 *
 *   npm run test:drafter-format
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const fs = await import("node:fs");

const built = compile(
  [
    "lib/drafter/document.ts",
    "lib/drafter/document-sections.ts",
    "lib/drafter/related-posts.ts",
    "lib/wordpress/sections.ts",
    "lib/wordpress/recipe-card.ts",
    "lib/drafter/recipe.ts",
  ],
  { prefix: ".fmt-" },
);

try {
  const { buildArticleDocument } = await built.load("lib/drafter/document.ts");
  const ds = await built.load("lib/drafter/document-sections.ts");
  const rp = await built.load("lib/drafter/related-posts.ts");
  const { classifyHeading, isDocumentMeta } = await built.load(
    "lib/wordpress/sections.ts",
  );

  /* The Vegan Lasagna card, as the client wrote it. */
  const doc = buildArticleDocument({
    title: "Vegan Lasagna Recipe",
    keyword: "vegan lasagna",
    content: "",
    recipeCard: {
      name: "Vegan Lasagna Recipe",
      recipeYield: "12 servings",
      estimatedCost: "$18",
      prepMinutes: 35,
      cookMinutes: 50,
      category: "Main",
      cuisine: "Italian",
      suitableForDiet: ["Vegan", "Vegetarian"],
      equipment: ["large pot", "colander", "food processor"],
      openingSentence:
        "Meaty AF walnut lentil filling, spinach tofu ricotta, and a garlic spiked mozzarella.",
      ingredients: ["1 cup dried brown lentils", "1 cup walnuts"],
      steps: [{ text: "Bring a large pot of water to a rolling boil.", name: "Boil George" }],
      tips: ["Al Dente Or Else"],
    },
    editorial: {
      seoDescription: "The most deluxe vegan lasagna recipe out there.",
      slug: "vegan-lasagna-recipe",
      categories: ["Italian", "Main"],
    },
  });

  const article = [
    "<h2>🥰 Why you'll adore this vegan lasagna recipe</h2>",
    "<p>Vegan AF.</p>",
    "<h2>✌️You'll also love these:</h2>",
    "<ul><li>Vegan Baked Ziti</li><li>Vegan Garlic Bread</li></ul>",
  ].join("\n");

  const related = [
    { wpId: 1201, title: "Vegan Baked Ziti" },
    { wpId: 1202, title: "Vegan Garlic Bread" },
    { wpId: 1203, title: "Vegan Pesto Pasta" },
    { wpId: 1204, title: "Vegan Eggplant Parm" },
  ];

  const body = ds.withDocumentSections(article, doc, related);

  /* ------------------------------------------------------------------ */
  console.log("\nThe four parts, in the client's order");

  const at = (needle) => body.indexOf(needle);
  const iWhy = at("Why you'll adore");
  const iRelated = at("also love these");
  const iFsri = at("FSRI post IDs");
  const iCard = at(ds.RECIPE_CARD_HEADING);
  const iSeo = at(ds.SEO_HEADING);

  check(iWhy >= 0, "the article is there");
  check(iRelated > iWhy, "then you'll also love these");
  check(iFsri > iRelated, "carrying the FSRI post IDs");
  check(iCard > iFsri, "then the recipe card");
  check(iSeo > iCard, "then the Yoast block, last");

  check(
    body.includes("1201, 1202, 1203, 1204"),
    "all four verified post IDs are printed",
  );
  check(
    body.split("FSRI post IDs").length === 2,
    "and printed once, not once per related item",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nEvery field the recipe card has to carry");

  for (const [label, needle] of [
    ["Title", "Vegan Lasagna Recipe"],
    ["Summary", "<strong>Summary:</strong>"],
    ["Yield", "<strong>Yield:</strong> 12 servings"],
    ["Cost", "<strong>Estimated Cost:</strong> $18"],
    ["Prep time", "<strong>Prep Time:</strong>"],
    ["Cook time", "<strong>Cook Time:</strong>"],
    ["Total time", "<strong>Total Time:</strong>"],
    ["Course", "<strong>Courses:</strong> Main"],
    ["Cuisine", "<strong>Cuisine:</strong> Italian"],
    ["Diet", "<strong>Diet:</strong> Vegan, Vegetarian"],
    ["Equipment", "<strong>Equipment:</strong>"],
    ["Ingredients", "<strong>Ingredients:</strong>"],
    ["Instructions", "<strong>Instructions:</strong>"],
    ["Tips", "<strong>Tips:</strong>"],
  ]) {
    check(body.includes(needle), `the card carries ${label}`);
  }

  check(
    body.includes("<strong>Total Time:</strong> 1 hr 25 mins"),
    "  and the total is derived from prep + cook, not stored",
    "35 + 50",
  );
  check(
    body.includes("1 cup dried brown lentils"),
    "  ingredients are printed exactly as the author wrote them",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nEvery field Yoast has to carry");

  for (const [label, needle] of [
    ["Meta description", "<strong>Meta description:</strong> The most deluxe"],
    ["URL slug", "<strong>URL slug:</strong> vegan-lasagna-recipe"],
    ["Focus keyphrase", "<strong>Focus keyphrase:</strong> vegan lasagna"],
    ["Primary category", "<strong>Primary Category:</strong> Italian"],
    ["Other categories", "<strong>Other Categories:</strong> Main"],
  ]) {
    check(body.includes(needle), `the Yoast block carries ${label}`);
  }

  check(
    !body.includes("<strong>Primary Category:</strong> Italian, Main"),
    "  the primary category is one value, as Yoast stores it",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nNothing stacks on a redraft");

  const twice = ds.withDocumentSections(body, doc, related);
  check(
    twice.split(ds.RECIPE_CARD_HEADING).length === 2,
    "a second pass adds no second recipe card",
  );
  check(
    twice.split(ds.SEO_HEADING).length === 2,
    "nor a second Yoast block",
  );
  check(
    twice.split("FSRI post IDs").length === 2,
    "nor a second FSRI line",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nNothing is invented");

  const bare = buildArticleDocument({
    title: "Vegan Torta de Milanesa Recipe",
    keyword: "vegan torta de milanesa",
    content: "",
    // The client left Estimated Cost blank on this one.
    recipeCard: {
      name: "Vegan Torta de Milanesa Recipe",
      recipeYield: "4 sandwiches",
      prepMinutes: 20,
      cookMinutes: 20,
      ingredients: ["14oz. Firm tofu"],
      steps: [{ text: "Press the tofu for 10 minutes.", name: "Meet the Press" }],
    },
    editorial: { categories: ["Mexican"] },
  });
  const bareBody = ds.withDocumentSections("<h2>Why</h2><p>x</p>", bare, []);

  check(
    !bareBody.includes("Estimated Cost"),
    "a cost the author did not give is omitted, not guessed",
  );
  check(
    bareBody.includes("<strong>Yield:</strong> 4 sandwiches"),
    "  but what they did give is printed",
  );
  check(
    !bareBody.includes("FSRI post IDs"),
    "no FSRI line when nothing resolved to a real post",
  );
  check(
    !bareBody.includes("also love these"),
    "  and no invented related section either",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nResolving the four posts");

  const index = {
    all: [{ wpId: 9, title: "Vegan Baked Ziti", slug: "vegan-baked-ziti", url: "", type: "post", terms: [] }],
    bySlug: new Map(),
    byTitle: new Map(),
  };
  index.bySlug.set("/vegan-baked-ziti", index.all[0]);
  index.byTitle.set("vegan baked ziti", index.all[0]);

  const section = rp.relatedSectionHtml(article);
  check(section.includes("also love these"), "the related section is found by its heading");
  check(
    !section.includes("Why you'll adore"),
    "  and nothing above it is dragged in",
  );

  const resolved = rp.resolveRelatedPosts(index, section);
  check(
    resolved.length === 1 && resolved[0].wpId === 9,
    "a name matching a published post resolves to its real ID",
    JSON.stringify(resolved),
  );
  check(
    resolved.every((r) => r.wpId > 0),
    "  and a name matching nothing is dropped rather than guessed at",
  );
  check(rp.FSRI_CARDS === 4, "the grid is four cards");

  /*
   * The run-on paragraph, taken from a real draft.
   *
   * The writer named four recipes that all existed and wrote them as four
   * lines, which became one paragraph. The link pass anchored two; the other
   * two were plain text with nothing between them, so there was no list item
   * to read and no anchor to follow, and two cards were lost to markup.
   */
  const wide = {
    all: [
      { wpId: 37819, title: "New Mexico Vegan Corn Chowder Recipe", slug: "corn-chowder", url: "", type: "post", terms: [] },
      { wpId: 38166, title: "Quick Pinto Bean Chili Recipe", slug: "pinto-chili", url: "", type: "post", terms: [] },
      { wpId: 37493, title: "One Pot Vegan Taco Soup", slug: "vegan-taco-soup", url: "", type: "post", terms: [] },
      { wpId: 38165, title: "Easy Vegan Tofu Chili Recipe", slug: "tofu-chili-recipe", url: "", type: "post", terms: [] },
      { wpId: 99, title: "Soup", slug: "soup", url: "", type: "post", terms: [] },
    ],
    bySlug: new Map(),
    byTitle: new Map(),
  };
  for (const t of wide.all) {
    wide.bySlug.set(`/${t.slug}`, t);
    wide.byTitle.set(t.title.toLowerCase(), t);
  }

  const runOn = [
    "<h2>✌️You'll also love these vegan soups:</h2>",
    '<p>New Mexico Vegan Corn Chowder Recipe <a href="https://cinnamonsnail.com/vegan-taco-soup/">One Pot Vegan Taco Soup</a> Quick Pinto Bean Chili Recipe <a href="https://cinnamonsnail.com/tofu-chili-recipe/">Easy Vegan Tofu Chili</a> Recipe</p>',
  ].join("\n");

  const recovered = rp.resolveRelatedPosts(wide, runOn);
  check(
    recovered.length === 4,
    "all four are recovered from a run-on paragraph",
    recovered.map((r) => r.wpId).join(", "),
  );
  check(
    !recovered.some((r) => r.wpId === 99),
    "  and a title too short to be meant is not swept up",
  );

  const unrelated = rp.resolveRelatedPosts(
    wide,
    "<h2>✌️You'll also love these:</h2><p>Nothing here names a real post.</p>",
  );
  check(
    unrelated.length === 0,
    "  a section naming nothing real still resolves to nothing",
    JSON.stringify(unrelated),
  );

  /* ------------------------------------------------------------------ */
  console.log("\nThe export reads these sections as fields, not as page content");

  check(
    classifyHeading("📋 Recipe Card") === "recipe",
    "the recipe card heading maps to the recipe slot",
  );
  check(
    isDocumentMeta("🔍 Yoast SEO"),
    "the Yoast heading is known to be document-only",
  );
  check(
    !isDocumentMeta("🥰 Why you'll adore this vegan lasagna recipe"),
    "  and an ordinary section is not",
  );
  check(
    !isDocumentMeta("💡Serving Ideas"),
    "  nor is serving ideas",
  );

  const mapper = fs.readFileSync("lib/wordpress/section-mapper.ts", "utf8");
  check(
    /if \(isDocumentMeta\(text\)\) \{[\s\S]{0,200}?continue;/.test(mapper),
    "readArticle skips it rather than filing it as unmatched",
  );

  const exportSrc = fs.readFileSync("lib/wordpress/draft-export.ts", "utf8");
  check(
    /resolveRelatedPosts\(index,/.test(exportSrc),
    "the exporter resolves the FSRI IDs through the same code the document used",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nThe card fields reach WPRM, not just the document");

  const { buildRecipePayload } = await built.load("lib/wordpress/recipe-card.ts");
  const { parseRecipe } = await built.load("lib/drafter/recipe.ts");

  /*
   * Cost, custom time and card tips were being dropped between the author and
   * the site. The connector has accepted all three since 1.5.0 — the loss was
   * entirely on this side, so the client's "$18" and his torta's "Pressing:
   * 10 minutes" reached the document and never reached WordPress.
   */
  const payload = buildRecipePayload(
    parseRecipe({
      name: "Vegan Torta de Milanesa Recipe",
      recipeYield: "4 sandwiches",
      estimatedCost: "$18",
      prepMinutes: 20,
      cookMinutes: 20,
      customTimeLabel: "Pressing",
      customMinutes: 10,
      openingSentence: "Crunchy tofu milanesa, chipotle doing its smoky razzle-dazzle.",
      description: "A different sentence entirely.",
      equipment: ["tofu press", "Dutch oven"],
      tips: ["Unloose the Juice", "Don't Try to Fry in Cold Oil"],
      ingredients: ["14oz. Firm tofu"],
      steps: [{ text: "Press the tofu for 10 minutes.", name: "Meet the Press" }],
    }),
    { title: "Vegan Torta de Milanesa Recipe" },
  );

  check(payload !== null, "a card with ingredients and steps produces a payload");
  check(payload?.cost === "$18", "the estimated cost is sent", payload?.cost);
  check(payload?.custom_time === 10, "the custom time is sent", String(payload?.custom_time));
  check(
    (payload?.notes ?? "").includes("Unloose the Juice"),
    "the card's tips are sent as WPRM notes",
  );
  check(
    payload?.equipment.join(", ") === "tofu press, Dutch oven",
    "the card's own equipment is sent when no explicit list is given",
    payload?.equipment.join(", "),
  );
  check(
    payload?.summary.startsWith("Crunchy tofu milanesa"),
    "the summary WPRM gets is the sentence the document printed",
    payload?.summary.slice(0, 30),
  );
  check(
    payload?.ingredients[0]?.name === "14oz. Firm tofu",
    "  and the ingredient is still byte-for-byte the author's",
  );

  const emptyCard = buildRecipePayload(
    parseRecipe({
      name: "No extras",
      ingredients: ["1 thing"],
      steps: [{ text: "Do it.", name: "" }],
    }),
    { title: "No extras" },
  );
  check(emptyCard?.cost === "", "an unstated cost is sent empty, not invented");
  check(emptyCard?.custom_time === 0, "  an unstated custom time is zero");
  check(emptyCard?.notes === "", "  and no tips means no notes");

  /* ------------------------------------------------------------------ */
  console.log("\nA missing section is asked for again, once");

  const gen = fs.readFileSync("lib/jobs/stages/generation.ts", "utf8");
  check(
    /const missing = group\.keys\.filter\(\(k\) => \(written\[k\] \?\? ""\) === ""\);\s*\n\s*if \(missing\.length > 0\) \{/.test(gen),
    "any missing section is retried, including a group of one",
  );
  check(
    !/missing\.length > 0 && group\.keys\.length > 1/.test(gen),
    "  the old rule that skipped single-section groups is gone",
  );
  check(
    /keys: \[key\]/.test(gen),
    "  the retry asks for that one section on its own",
  );

  const save = fs.readFileSync("lib/jobs/stages/finishing.ts", "utf8");
  check(
    /withDocumentSections\(html, doc, related\)/.test(save),
    "and the pipeline actually assembles the document",
  );
} finally {
  built.cleanup();
}

console.log(
  failures === 0
    ? "\nAll Drafter format checks passed.\n"
    : `\n${String(failures)} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
