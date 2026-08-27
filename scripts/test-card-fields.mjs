/**
 * Recipe-card fields derived from the article's own data.
 *
 * The rule these exist to keep: derive from what is already known, never
 * invent. A cook time nobody stated is a false claim published as structured
 * data, so the fields that only live in the author's head stay empty.
 *
 *   npm run test:card-fields
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const built = compile(["lib/drafter/card-fields.ts", "lib/drafter/recipe.ts"], {
  prefix: ".cardfields-",
});

try {
  const { deriveCardFields, cuisineFrom, courseFrom } = await built.load(
    "lib/drafter/card-fields.ts",
  );
  const { parseRecipe } = await built.load("lib/drafter/recipe.ts");

  console.log("\nCuisine and course read off the real taxonomy");
  check(
    cuisineFrom(["Mains", "Vegan Mexican Recipes"]) === "Mexican",
    "a cuisine category yields the cuisine, not the category name",
    cuisineFrom(["Mains", "Vegan Mexican Recipes"]),
  );
  check(
    cuisineFrom(["Vegan Tex Mex Recipes"]) === "Tex-Mex",
    "a hyphenated cuisine keeps its hyphen",
    cuisineFrom(["Vegan Tex Mex Recipes"]),
  );
  check(cuisineFrom(["Mains", "Sides"]) === "", "no cuisine category yields nothing");
  check(
    cuisineFrom(["Indianapolis Guides"]) === "",
    "whole-word matching: Indianapolis is not Indian",
  );
  check(
    courseFrom(["Vegan Mexican Recipes", "Mains"]) === "Mains",
    "the course category is picked out",
    courseFrom(["Vegan Mexican Recipes", "Mains"]),
  );
  check(
    courseFrom(["Mains", "Vegan Soups"]) === "Mains, Vegan Soups",
    "several courses are kept, in order",
    courseFrom(["Mains", "Vegan Soups"]),
  );

  console.log("\nDeriving fills only what it can justify");
  const bare = parseRecipe({
    name: "Vegan Tamale Pie",
    description: "A hearty pie with smoky chili.",
    ingredients: ["2 cups masa harina"],
    steps: [{ text: "Mix.", name: "" }],
  });
  const filled = deriveCardFields(bare, {
    categories: ["Tex-Mex", "Mains", "Super-Bowl"],
    focusKeyword: "vegan tamale pie",
  });

  check(filled.cuisine === "Tex-Mex", "Cuisine", filled.cuisine);
  check(filled.category === "Mains", "Course", filled.category);
  check(filled.keywords === "vegan tamale pie", "Keyword", filled.keywords);
  check(
    filled.openingSentence === "A hearty pie with smoky chili.",
    "Summary comes from the card's own opening sentence",
  );

  console.log("\nAnd never invents what only the author knows");
  for (const [field, value] of [
    ["recipeYield", filled.recipeYield],
    ["estimatedCost", filled.estimatedCost],
    ["customTimeLabel", filled.customTimeLabel],
  ]) {
    check(value === "", `${field} stays empty`, JSON.stringify(value));
  }
  check(filled.prepMinutes === 0, "prep time stays unset");
  check(filled.cookMinutes === 0, "cook time stays unset");
  check(filled.equipment.length === 0, "equipment stays empty");

  console.log("\nThe author's own values always win");
  const authored = parseRecipe({
    name: "X",
    cuisine: "Japanese",
    category: "Desserts",
    keywords: "kabocha",
    openingSentence: "The author's sentence.",
    description: "A different description.",
    ingredients: ["1 cup flour"],
    steps: [{ text: "Mix.", name: "" }],
  });
  const kept = deriveCardFields(authored, {
    categories: ["Vegan Mexican Recipes", "Mains"],
    focusKeyword: "something else",
  });
  check(kept.cuisine === "Japanese", "a set cuisine is not overwritten");
  check(kept.category === "Desserts", "a set course is not overwritten");
  check(kept.keywords === "kabocha", "a set keyword is not overwritten");
  check(
    kept.openingSentence === "The author's sentence.",
    "a written opening sentence is not replaced by the description",
  );

  console.log("\nThe input is not mutated");
  check(bare.cuisine === "", "deriving returns a new card and leaves the original alone");
} finally {
  built.cleanup();
}

console.log(
  failures === 0 ? "\nAll card-field checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
