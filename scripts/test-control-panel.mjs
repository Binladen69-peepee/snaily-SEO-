/**
 * What the article-control panel reports.
 *
 * Both of these answer questions the author currently only finds out about
 * late: that a section went missing during generation, and that WP Recipe
 * Maker will warn about empty card fields once the post is already exported.
 *
 *   npm run test:control-panel
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const built = compile(
  ["lib/drafter/outline-map.ts", "lib/drafter/card-completeness.ts", "lib/drafter/recipe.ts"],
  { prefix: ".controlpanel-" },
);

try {
  const { outlineMap } = await built.load("lib/drafter/outline-map.ts");
  const { cardCompleteness } = await built.load("lib/drafter/card-completeness.ts");
  const { parseRecipe } = await built.load("lib/drafter/recipe.ts");

  /* ------------------------------------------------------------------ */
  console.log("\nSections — the one that went missing");

  // The Moroccan sweet potato soup as it shipped: no ingredients section.
  const shipped = [
    "<h2>🥰 Why you'll adore moroccan sweet potato soup</h2><p>x</p>",
    "<h2>🤯 Variations</h2><p>x</p>",
    "<h2>📖 How to make it</h2><p>x</p>",
    "<h2>💡 Serving Ideas</h2><p>x</p>",
    "<h2>👉 Top tips</h2><p>x</p>",
    "<h2>🤷‍♀️ Recipe FAQs</h2><p>x</p>",
    "<h2>✌️You'll love these too</h2><p>x</p>",
  ].join("");

  const map = outlineMap(shipped);
  const missingKeys = map.missing.map((m) => m.key);

  check(
    missingKeys.includes("ingredients"),
    "the absent specialty-ingredients section is reported missing",
    missingKeys.join(", ") || "(none)",
  );
  check(
    map.missing.find((m) => m.key === "ingredients")?.required === true,
    "and is marked required, not optional",
  );
  check(
    map.entries.length === 7,
    "every heading that IS present is listed",
    String(map.entries.length),
  );
  check(
    map.present === 7 && map.expected === 8,
    "the counter reads 7 of 8",
    `${String(map.present)}/${String(map.expected)}`,
  );

  // Negative control: a complete article reports nothing missing.
  const complete = shipped.replace(
    "<h2>🤯 Variations</h2>",
    "<h2>🧁 Specialty Ingredients</h2><p>x</p><h2>🤯 Variations</h2>",
  );
  const full = outlineMap(complete);
  check(
    full.missing.length === 0,
    "a complete article reports nothing missing",
    full.missing.map((m) => m.key).join(", ") || "(none)",
  );
  check(full.present === 8, "and counts 8 of 8");

  check(
    outlineMap("").entries.length === 0,
    "an empty document produces no headings rather than throwing",
  );

  const unknown = outlineMap("<h2>Something the template has no name for</h2>");
  check(
    unknown.entries.length === 1 && unknown.entries[0].key === null,
    "a heading the template cannot classify is still listed, with no key",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nRecipe card — what WPRM would warn about");

  // The Stroganoff card exactly as it was stored: source only, no metadata.
  const bare = parseRecipe({
    name: "vegan mushroom stroganoff",
    ingredients: Array.from({ length: 15 }, (_, i) => `ingredient ${String(i + 1)}`),
    steps: Array.from({ length: 9 }, (_, i) => ({ text: `step ${String(i + 1)}`, name: "" })),
  });

  const bareCard = cardCompleteness(bare);
  const missing = bareCard.missingRecommended.map((f) => f.key);

  check(
    missing.includes("yield") && missing.includes("prep") && missing.includes("cook"),
    "servings and both times are flagged",
    missing.join(", "),
  );
  check(
    missing.includes("course") && missing.includes("cuisine") && missing.includes("keywords"),
    "course, cuisine and keyword are flagged — WPRM's own recommended list",
  );
  check(
    !missing.includes("ingredients") && !missing.includes("instructions"),
    "the source the author did supply is not flagged",
  );
  check(
    bareCard.fields.find((f) => f.key === "ingredients")?.value === "15 lines",
    "ingredients report their count",
  );
  check(
    bareCard.fields.find((f) => f.key === "instructions")?.value === "9 steps",
    "and so do instructions",
  );
  check(
    !bareCard.fields.some((f) => f.key === "calories" || f.label === "Calories"),
    "nutrition is absent — WPRM calculates it, so it is not the author's gap",
  );

  const full2 = cardCompleteness(
    parseRecipe({
      name: "Kabocha Soup",
      openingSentence: "A bowl that tastes like October.",
      ingredients: ["1 cup flour"],
      steps: [{ text: "Mix.", name: "" }],
      recipeYield: "10 servings",
      prepMinutes: 15,
      cookMinutes: 40,
      category: "Mains",
      cuisine: "Japanese",
      keywords: "kabocha",
    }),
  );
  check(
    full2.missingRecommended.length === 0,
    "a fully filled card flags nothing",
    full2.missingRecommended.map((f) => f.key).join(", ") || "(none)",
  );
  check(
    full2.fields.find((f) => f.key === "prep")?.value === "15 mins",
    "times render readably rather than as raw minutes",
    full2.fields.find((f) => f.key === "prep")?.value,
  );
  check(
    full2.fields.find((f) => f.key === "cook")?.value === "40 mins",
    "and so does the cook time",
  );
} finally {
  built.cleanup();
}

console.log(
  failures === 0 ? "\nAll control-panel checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
