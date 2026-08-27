/**
 * Refusing a cuisine the article does not support.
 *
 * The bug: a Vietnamese banh mi went out filed under Mexican, Thai and
 * Italian. All three are real shelves on the site, so validating that a
 * category exists caught nothing. The recipe card then derived its cuisine
 * from those categories, turning a wrong shelf into a false claim in
 * structured data.
 *
 *   npm run test:cuisine-gate
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const built = compile(["lib/drafter/cuisine-gate.ts"], { prefix: ".cuisinegate-" });

/** The client's real cuisine shelves. */
const SITE = [
  "Mains", "Sides", "Vegan Soups", "Vegan Mexican Recipes",
  "Vegan Thai Recipes", "Vegan Italian Recipes", "Vegan Tex Mex Recipes",
  "Vietnamese Vegan Recipes", "Turkish Recipes", "Middle Eastern Recipes",
].map((name) => ({ name, count: 30 }));

try {
  const { cuisineOf, mentions, gateCuisines, evidenceFrom } = await built.load(
    "lib/drafter/cuisine-gate.ts",
  );

  console.log("\nTelling a cuisine shelf from a course shelf");
  check(cuisineOf("Vietnamese Vegan Recipes") === "vietnamese", "a cuisine category");
  check(cuisineOf("Vegan Tex Mex Recipes") === "tex mex", "Tex-Mex beats Mexican", cuisineOf("Vegan Tex Mex Recipes"));
  check(cuisineOf("Mains") === null, "a course is not a cuisine");
  check(cuisineOf("Vegan Soups") === null, "and neither is a soup");

  console.log("\nThe banh mi that started this");
  const banh = gateCuisines(
    ["Mains", "Vegan Mexican Recipes", "Vegan Thai Recipes", "Vegan Italian Recipes"],
    SITE,
    "A Vietnamese sandwich. Vietnamese baguettes, Vietnamese herbs.",
    "Vegan Banh Mi Sandwich vegan banh mi Vietnamese baguette",
  );
  check(
    !banh.categories.includes("Vegan Mexican Recipes") &&
      !banh.categories.includes("Vegan Thai Recipes") &&
      !banh.categories.includes("Vegan Italian Recipes"),
    "all three unsupported cuisines are dropped",
    banh.categories.join(", "),
  );
  check(banh.categories.includes("Vietnamese Vegan Recipes"), "and Vietnamese is used instead");
  check(banh.categories.includes("Mains"), "the course category is untouched");
  check(banh.dropped.length === 3, "the drops are reported", String(banh.dropped.length));

  console.log("\nA correct assignment is left alone");
  const tamale = gateCuisines(
    ["Mains", "Vegan Tex Mex Recipes", "Vegan Mexican Recipes", "Sides"],
    SITE,
    "A Tex-Mex tamale pie. Mexican flavours throughout.",
    "Vegan Tamale Pie vegan tamale pie masa harina",
  );
  check(
    tamale.categories.length === 4 && tamale.dropped.length === 0,
    "nothing is dropped when the article supports it",
    tamale.categories.join(", "),
  );

  console.log("\nRather blank than wrong");
  // The stroganoff's prose names a Turkish flatbread in its serving ideas.
  const strog = gateCuisines(
    ["Mains", "Vegan Italian Recipes", "Sides", "Vegan Soups"],
    SITE,
    "Serve with Bazlama, the warm Turkish flatbread. A Turkish bread works well.",
    "Vegan Mushroom Stroganoff vegan mushroom stroganoff mushrooms sour cream",
  );
  check(
    !strog.categories.includes("Vegan Italian Recipes"),
    "an unsupported Italian is dropped",
  );
  check(
    strog.added === null,
    "and Turkish is NOT added from prose about another dish",
    strog.added ?? "none",
  );
  check(
    strog.categories.every((c) => cuisineOf(c) === null),
    "the post is left with no cuisine rather than a wrong one",
    strog.categories.join(", "),
  );

  console.log("\nEvidence excludes the sections that name other dishes");
  const html = [
    "<p>A Vietnamese classic.</p>",
    "<h2>🥰 Why you'll adore it</h2><p>Vietnamese herbs.</p>",
    "<h2>💡Serving Ideas</h2><p>With <a href='/x'>Bazlama (Turkish Flatbread)</a> and Turkish tea.</p>",
    "<h2>✌️You'll also love these</h2><p>Italian pasta, Thai curry.</p>",
  ].join("");
  const ev = evidenceFrom({ title: "Banh Mi", keyword: "banh mi", recipe: "", html });
  check(mentions(ev, "vietnamese") >= 2, "the dish's own sections are kept", String(mentions(ev, "vietnamese")));
  check(mentions(ev, "turkish") === 0, "serving ideas are excluded", String(mentions(ev, "turkish")));
  check(mentions(ev, "italian") === 0, "and so is the closing round-up");

  console.log("\nNever invents a shelf the site does not have");
  const noShelf = gateCuisines(
    ["Mains", "Vegan Italian Recipes"],
    [{ name: "Mains", count: 10 }, { name: "Vegan Italian Recipes", count: 10 }],
    "A Russian classic. Russian sour cream.",
    "Beef Stroganoff russian stroganoff",
  );
  check(
    noShelf.added === null,
    "no Russian shelf exists, so none is created",
    noShelf.added ?? "none",
  );
  check(
    !noShelf.categories.includes("Vegan Italian Recipes"),
    "and the wrong one is still dropped",
  );
} finally {
  built.cleanup();
}

console.log(
  failures === 0 ? "\nAll cuisine-gate checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
