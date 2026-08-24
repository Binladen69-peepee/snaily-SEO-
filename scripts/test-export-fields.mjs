/**
 * The fields the export sends to WordPress, checked without a WordPress.
 *
 * These are the parts that are invisible until they are wrong on a live post:
 * a recipe card whose ingredients were quietly re-parsed, a category the site
 * does not have, a focus keyphrase that never got set. Each is a pure function
 * on data, so each is testable here rather than by exporting and squinting.
 *
 *   npm run test:export-fields
 */
import { createServer } from "node:http";

import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

const built = compile(
  [
    "lib/drafter/recipe.ts",
    "lib/drafter/categories.ts",
    "lib/wordpress/recipe-card.ts",
    "lib/wordpress/connector-status.ts",
    "lib/wordpress/client.ts",
    "lib/db.ts",
  ],
  { prefix: ".exportfields-" },
);

const { buildRecipePayload, splitYield, hasRecipeContent } = await built.load(
  "lib/wordpress/recipe-card.ts",
);
const { resolveCategories, matchTerm } = await built.load(
  "lib/drafter/categories.ts",
);
const { parseRecipe } = await built.load("lib/drafter/recipe.ts");
const { connectorStatus, isAtLeast, CONNECTOR_DOWNLOAD_PATH } = await built.load(
  "lib/wordpress/connector-status.ts",
);
const { verifyConnection, updateDraft } = await built.load("lib/wordpress/client.ts");

/** A stand-in WordPress that answers however the test needs it to. */
function fakeSite(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

try {
  /* ------------------------------------------------------------------ */
  console.log("\nRecipe integrity — the author's words, untouched");

  // The real Kabocha Squash Soup paste, exactly as it is stored.
  const kabochaLines = [
    "2 tablespoons toasted sesame oil",
    "2 cups onion, diced",
    "1 tablespoon ginger, grated",
    "2 teaspoons 5-spice",
    "3 lb. Kabocha squash, seeded and diced",
    "15 oz. coconut milk, full fat",
    "8 red jujube dates, sliced and rehydrated",
  ];
  const steps = [
    { text: "Heat the toasted sesame oil in a large pot over medium heat.", name: "" },
    { text: "Add the kabocha and cook for 8 minutes, until the edges soften.", name: "" },
  ];

  const card = parseRecipe({
    name: "Cozy Vegan Kabocha Squash Soup",
    description: "A sweet-spicy autumn bowl.",
    ingredients: kabochaLines,
    steps,
    recipeYield: "10 servings",
    prepMinutes: 15,
    cookMinutes: 40,
    category: "Mains",
    cuisine: "Japanese",
    keywords: "kabocha, squash soup",
    suitableForDiet: ["vegan", "GlutenFreeDiet"],
  });

  const payload = buildRecipePayload(card, { title: "Fallback Title" });

  check(payload !== null, "a recipe with ingredients and steps produces a card");
  check(
    payload.ingredients.length === kabochaLines.length,
    "every ingredient line is carried across",
  );
  check(
    payload.ingredients.every((ing, i) => ing.name === kabochaLines[i]),
    "each ingredient is byte-for-byte the line the author typed",
  );
  check(
    payload.ingredients.every((ing) => ing.amount === "" && ing.unit === ""),
    "nothing is split into an amount or a unit, because that would be inference",
  );
  check(
    payload.ingredients[3].name === "2 teaspoons 5-spice",
    "a number inside a name survives - 5-spice is not parsed into anything",
  );
  check(
    payload.instructions.length === steps.length &&
      payload.instructions[0].text === steps[0].text,
    "instructions are carried across in order and unedited",
  );
  check(
    payload.ingredients.map((i) => i.name).join("|") === kabochaLines.join("|"),
    "and the order is the recipe's own",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nRecipe metadata around the untouched parts");

  check(payload.name === "Cozy Vegan Kabocha Squash Soup", "the card takes the recipe's name");
  check(payload.servings === "10" && payload.servings_unit === "servings", "the yield splits into a number and a unit");
  check(payload.prep_time === 15 && payload.cook_time === 40, "times are carried as minutes");
  check(
    payload.course.join() === "Mains" && payload.cuisine.join() === "Japanese",
    "course and cuisine become WPRM taxonomies",
  );
  check(
    payload.suitablefordiet.includes("Vegan") &&
      payload.suitablefordiet.includes("Gluten Free"),
    "schema diet values become the labels WPRM stores",
  );

  check(splitYield("18").servings === "18", "a bare number yield keeps its number");
  check(splitYield("9 cups").unit === "cups", "and its unit");
  check(splitYield("a big pot").servings === "", "an unparseable yield is passed through whole");

  const empty = parseRecipe({ name: "Nothing", ingredients: [], steps: [] });
  check(!hasRecipeContent(empty), "an empty recipe is recognised as empty");
  check(
    buildRecipePayload(empty, { title: "x" }) === null,
    "and no card is built, rather than an empty one being created on the site",
  );

  const stepsOnly = parseRecipe({
    name: "Half",
    ingredients: ["1 cup flour"],
    steps: [],
  });
  check(
    buildRecipePayload(stepsOnly, { title: "x" }) === null,
    "a recipe with ingredients but no method is refused too",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nCategories — real terms only");

  const siteCategories = [
    { name: "Mains", count: 102 },
    { name: "Gluten-free", count: 262 },
    { name: "Middle Eastern Recipes", count: 58 },
    { name: "Sauces & Dressings", count: 56 },
    { name: "Vegan Thanksgiving Recipes", count: 63 },
  ];
  const siteTags = [{ name: "Seitan", count: 4 }];

  const reply = [
    "TITLE: Something",
    "PRIMARY: Middle Eastern",
    "OTHER: Mains, Tex-Mex Comfort Food, Gluten-free",
    "TAGS: Seitan, Tofu",
  ].join("\n");

  const chosen = resolveCategories(reply, siteCategories, siteTags);

  check(
    chosen.categories[0] === "Middle Eastern Recipes",
    "the primary category is first, matched to the site's real name",
  );
  check(
    chosen.categories.includes("Mains") && chosen.categories.includes("Gluten-free"),
    "the other real categories come through",
  );
  check(
    !chosen.categories.includes("Tex-Mex Comfort Food"),
    "a category the site does not have is dropped, never created",
  );
  check(
    chosen.rejected.includes("Tex-Mex Comfort Food"),
    "and is reported so the author can see what was asked for",
  );
  check(chosen.tags.join() === "Seitan", "an invented tag is dropped the same way");
  check(
    matchTerm("Sauces and Dressings", siteCategories)?.name === "Sauces & Dressings",
    "an ampersand written out as a word still matches",
  );
  check(matchTerm("Desserts", siteCategories) === null, "and a near-miss matches nothing");

  const none = resolveCategories("TITLE: x", siteCategories, siteTags);
  check(
    none.categories.length === 0 && none.rejected.length === 0,
    "a reply with no category lines produces no categories and no noise",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA 404 from the site");

  /*
   * WordPress answers `rest_no_route` both when a plugin is too old to have a
   * newer route and when no plugin registered the namespace at all. Reading
   * the body as the signal told someone mid-way through replacing the plugin
   * that their connector was out of date — so the caller decides, and only a
   * route flagged as newer counts as outdated.
   */
  const absent = await fakeSite((req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        code: "rest_no_route",
        message: "No route was found matching the URL and request method.",
        data: { status: 404 },
      }),
    );
  });

  let kind = "";
  try {
    await verifyConnection(absent.url, "a-token");
  } catch (err) {
    kind = err.kind ?? "";
  }
  check(
    kind === "plugin_missing",
    "no connector at all reads as the plugin being missing",
    kind,
  );

  let updateKind = "";
  try {
    await updateDraft(absent.url, "a-token", 123, { title: "x", content: "y" });
  } catch (err) {
    updateKind = err.kind ?? "";
  }
  check(
    updateKind === "route_missing",
    "but a route the caller flagged as newer still reads as out of date",
    updateKind,
  );

  await absent.close();

  /* ------------------------------------------------------------------ */
  console.log("\nConnector status — the four states");

  const state = (reason, installed, latest = "1.4.0") =>
    connectorStatus({ reason, installed, latest }).state;

  check(state("OK", "1.4.0") === "up-to-date", "current and answering is up to date");
  check(state("OK", "1.5.0") === "up-to-date", "a newer install is not called out of date");
  check(state("OK", "1.3.0") === "update-required", "an older install needs updating");
  check(
    state("OUTDATED_PLUGIN", "1.3.0") === "update-required",
    "and so does one the verify endpoint already flagged",
  );
  check(
    state("OK", "unknown") === "update-required",
    "an install too old to report its version is treated as out of date",
  );
  check(
    state("NOT_CONFIGURED", null) === "not-installed",
    "no stored token reads as not installed",
  );
  check(
    state("PLUGIN_NOT_ACTIVE", null) === "not-installed",
    "and so does a site with no connector routes",
  );
  check(
    state("ENDPOINT_UNREACHABLE", null) === "connection-lost",
    "an unreachable site is a lost connection, not a missing plugin",
  );
  check(
    state("INVALID_SECRET", "1.4.0") === "connection-lost",
    "a rejected token is a lost connection even on a current plugin",
  );
  check(
    state("DOMAIN_MISMATCH", "1.4.0") === "connection-lost",
    "so is an answer from the wrong domain",
  );

  check(
    connectorStatus({ reason: "NOT_CONFIGURED", installed: null, latest: "1.4.0" })
      .needsReconnect === true,
    "a missing install offers Reconnect",
  );
  check(
    connectorStatus({ reason: "OUTDATED_PLUGIN", installed: "1.3.0", latest: "1.4.0" })
      .needsReconnect === false,
    "an out-of-date install does not - downloading the zip is the fix",
  );

  check(isAtLeast("1.10.0", "1.9.0"), "versions compare numerically, not as strings");
  check(!isAtLeast("1.4", "1.4.1"), "and a missing segment counts as zero");
  check(
    CONNECTOR_DOWNLOAD_PATH === "/api/wordpress/plugin",
    "both screens download from the one route",
  );

  const dupes = resolveCategories(
    "PRIMARY: Mains\nOTHER: Mains, Mains",
    siteCategories,
    siteTags,
  );
  check(dupes.categories.length === 1, "the same category twice is filed once");
} finally {
  built.cleanup();
}

console.log(
  failures === 0 ? "\nAll export field checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
