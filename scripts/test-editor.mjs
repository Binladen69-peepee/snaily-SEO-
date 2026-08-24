/**
 * Regression tests for the editor's analysis modules.
 *
 * Readability, outline and recipe schema all feed numbers and claims into the
 * UI, and two of them (syllables, passive voice) are heuristics that are easy
 * to break silently. Recipe JSON-LD is the highest-stakes of the three: it is
 * a machine-readable factual claim to Google about a real dish, so the tests
 * pin hard that blank fields are omitted rather than emitted empty.
 *
 *   node scripts/test-editor.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".editortest-"));

const SOURCES = [
  "lib/drafter/readability.ts",
  "lib/drafter/outline.ts",
  "lib/drafter/recipe.ts",
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
      types: [],
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

for (const file of SOURCES) {
  const p = join(out, file.replace(/\.ts$/, ".js"));
  const src = readFileSync(p, "utf8");
  const prefix = "../".repeat(file.split("/").length - 1) || "./";
  writeFileSync(
    p,
    src.replace(/from "@\/(.*?)"/g, (_m, rest) => `from "${prefix}${rest}.js"`),
  );
}

const R = await import(pathToFileURL(join(out, "lib/drafter/readability.js")).href);
const O = await import(pathToFileURL(join(out, "lib/drafter/outline.js")).href);
const Rec = await import(pathToFileURL(join(out, "lib/drafter/recipe.js")).href);

try {
  /* ------------------------------------------------------------------ */
  console.log("\nSyllables");
  for (const [word, n] of [
    ["cake", 1], ["hummus", 2], ["beet", 1], ["delicious", 3],
    ["the", 1], ["a", 1], ["vegan", 2], ["chocolate", 3],
  ]) {
    const got = R.syllables(word);
    check(got === n, `"${word}" → ${String(got)} (expected ${String(n)})`);
  }

  /* ------------------------------------------------------------------ */
  console.log("\nSentence splitting");
  const tricky =
    "Heat the oven to 350°F (175°C). Bake for 25 minutes until golden. " +
    "Use 1.5 cups of flour and a pinch of salt for the base.";
  const sents = R.sentencesOf(tricky);
  check(sents.length === 3, `3 sentences from decimals and units, got ${String(sents.length)}`);

  /* ------------------------------------------------------------------ */
  console.log("\nPassive voice");
  check(
    R.passiveHits("The beets were roasted until tender.").length === 1,
    "catches 'were roasted'",
  );
  check(
    R.passiveHits("The dough was gently folded into the bowl.").length === 1,
    "catches an adverb between auxiliary and participle",
  );
  check(
    R.passiveHits("The beets are taken from the oven.").length === 1,
    "catches the irregular participle 'taken'",
  );
  check(
    R.passiveHits("I roasted the beets until they were tender.").length === 0,
    "does not flag active voice ('were tender' is not a participle)",
  );
  check(
    R.passiveHits("She is baking the bread right now.").length === 0,
    "does not flag a present continuous",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nReadability report");
  const body =
    "<p>" +
    ("This hummus is bright and fresh. You will love it. " +
      "Roast the beets first. ").repeat(12) +
    "</p>";
  const rep = R.analyseReadability(body);
  check(rep.flesch !== null, "scores a body over the minimum word count");
  check(
    rep.flesch >= 0 && rep.flesch <= 120,
    `Flesch lands in a sane range (${String(rep.flesch)})`,
  );
  check(rep.grade !== "—", `band is named: ${rep.grade}`);
  check(
    R.analyseReadability("<p>Too short.</p>").flesch === null,
    "refuses to score a body that is too short rather than guessing",
  );
  check(
    R.analyseReadability("").words === 0,
    "empty input yields zero words, not NaN",
  );

  const longP = R.analyseReadability(
    "<p>One sentence here. Two sentences here. Three sentences here. Four sentences here.</p>",
  );
  check(longP.longParagraphs.length === 1, "flags a four-sentence paragraph");

  /* ------------------------------------------------------------------ */
  console.log("\nOutline");
  const doc =
    "<h2>Why you will adore it</h2><p>Some words here about the dish.</p>" +
    "<h3>Ingredients</h3><p>More words.</p>" +
    "<h2>How to make it</h2><p>Method words.</p>";
  const outline = O.buildOutline(doc);
  check(outline.nodes.length === 3, `3 headings found, got ${String(outline.nodes.length)}`);
  check(outline.nodes[0].level === 2, "first heading is H2");
  check(outline.nodes[0].words > 0, "counts the words under a heading");
  check(outline.problems.length === 0, "clean document reports no problems");

  const skipped = O.buildOutline("<h2>A</h2><p>x</p><h4>B</h4><p>y</p>");
  check(
    skipped.problems.some((p) => /jumps from H2 to H4/.test(p.message)),
    "flags a skipped heading level",
  );
  check(
    O.buildOutline("<h1>Title</h1><h2>A</h2><p>x</p>").problems.some((p) =>
      /H1 in the body/.test(p.message),
    ),
    "flags an H1 in the body",
  );
  check(
    O.buildOutline("<h3>Starts too deep</h3><p>x</p>").problems.some((p) =>
      /Start at H2/.test(p.message),
    ),
    "flags a document that starts at H3",
  );
  check(
    O.buildOutline("<h2>A</h2><h2>B</h2><p>x</p>").problems.some((p) =>
      /no text under it/.test(p.message),
    ),
    "flags an empty section",
  );

  const dupe = O.buildOutline("<h2>Tips</h2><p>x</p><h2>Tips</h2><p>y</p>");
  check(
    dupe.problems.some((p) => /repeats a heading/.test(p.message)),
    "flags a duplicated heading",
  );
  check(
    dupe.nodes[0].id !== dupe.nodes[1].id,
    "gives duplicate headings distinct anchors",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nISO durations");
  check(Rec.isoDuration(0) === "", "0 minutes yields nothing, not PT0M");
  check(Rec.isoDuration(30) === "PT30M", "30 → PT30M");
  check(Rec.isoDuration(90) === "PT1H30M", "90 → PT1H30M");
  check(Rec.isoDuration(120) === "PT2H", "120 → PT2H (no stray 0M)");

  /* ------------------------------------------------------------------ */
  console.log("\nRecipe JSON-LD");
  check(
    Rec.recipeJsonLd(Rec.EMPTY_RECIPE) === null,
    "no recipe name means no structured data at all",
  );

  const card = Rec.parseRecipe({
    name: "Vegan Beet Hummus",
    imageUrl: "https://cinnamonsnail.com/beet-hummus.jpg",
    recipeYield: "3 cups",
    prepMinutes: 15,
    cookMinutes: 45,
    ingredients: ["2 medium beets", "1 can chickpeas", ""],
    steps: [{ text: "Roast the beets.", name: "Roast" }, { text: "", name: "" }],
    calories: 180,
    author: "Adam Sobel",
    suitableForDiet: ["VeganDiet"],
  });

  const ld = Rec.recipeJsonLd(card, { url: "https://cinnamonsnail.com/x" });
  check(ld["@type"] === "Recipe", "emits @type Recipe");
  check(Array.isArray(ld.image) && ld.image.length === 1, "image is an array");
  check(ld.totalTime === "PT1H", "totalTime sums prep and cook");
  check(
    Array.isArray(ld.recipeIngredient) && ld.recipeIngredient.length === 2,
    "blank ingredient lines are dropped",
  );
  check(
    Array.isArray(ld.recipeInstructions) &&
      ld.recipeInstructions.length === 1 &&
      ld.recipeInstructions[0]["@type"] === "HowToStep",
    "steps become HowToStep objects and blanks are dropped",
  );
  check(
    ld.nutrition?.calories === "180 calories",
    "calories are formatted as schema.org expects",
  );
  check(
    ld.suitableForDiet?.[0] === "https://schema.org/VeganDiet",
    "diets become schema.org URLs",
  );
  check(!("description" in ld), "a blank description is omitted, not emitted empty");
  check(!("recipeCuisine" in ld), "a blank cuisine is omitted, not emitted empty");

  const noTimes = Rec.recipeJsonLd(
    Rec.parseRecipe({ name: "X", imageUrl: "https://e.com/a.jpg" }),
  );
  check(
    !("cookTime" in noTimes) && !("totalTime" in noTimes),
    "unset times are omitted rather than claimed as zero",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nRecipe validation");
  const issues = Rec.validateRecipe(
    Rec.parseRecipe({ name: "X", imageUrl: "/relative.jpg" }),
  );
  check(
    issues.some((i) => i.field === "imageUrl" && i.severity === "error"),
    "a relative image URL is an error",
  );
  check(
    issues.some((i) => i.field === "recipeYield" && i.severity === "error"),
    "a missing yield is an error",
  );
  check(
    Rec.validateRecipe(card).filter((i) => i.severity === "error").length === 0,
    "a complete card has no errors",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nScript tag escaping");
  const evil = Rec.recipeScriptTag(
    Rec.parseRecipe({
      name: "Evil </script><img src=x onerror=alert(1)>",
      imageUrl: "https://e.com/a.jpg",
    }),
  );
  check(!evil.includes("</script><img"), "a closing script tag in a field cannot break out");
  check(evil.includes("\\u003c"), "angle brackets are escaped in the JSON payload");
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll editor-analysis checks passed.");
