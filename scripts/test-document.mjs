/**
 * The canonical ArticleDocument, and the two sections the client asked to see
 * inside the document itself.
 *
 * The Vegan Tamale Pie article is the reference: its STRUCTURE and taxonomy
 * behaviour are the template, not its values. Its categories are
 *   Primary: Tex-Mex     Other: Mains, Super-Bowl
 * and the exporter has to reproduce that relationship for any recipe.
 *
 *   npm run test:document
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const built = compile(
  ["lib/drafter/document.ts", "lib/drafter/document-sections.ts"],
  { prefix: ".doctest-" },
);

try {
  const {
    buildArticleDocument,
    splitCategories,
    excerptFor,
    formatMinutes,
    hasRecipe,
  } = await built.load("lib/drafter/document.ts");
  const {
    renderRecipeCardSection,
    renderSeoSection,
    withDocumentSections,
    RECIPE_CARD_HEADING,
    SEO_HEADING,
  } = await built.load("lib/drafter/document-sections.ts");

  /* ------------------------------------------------------------------ */
  console.log("\nThe Tamale Pie taxonomy relationship");

  const tamale = buildArticleDocument({
    title: "Vegan Tamale Pie: Cozy Cornbread Casserole",
    keyword: "vegan tamale pie",
    content:
      "<h2>🥰 Why you'll adore it</h2><p>Because.</p><h2>📖 How to make it</h2><p>Steps.</p>",
    editorial: {
      // resolveCategories stores the primary first.
      categories: ["Tex-Mex", "Mains", "Super-Bowl"],
      seoDescription: "A hearty tamale pie with smoky chili and cornbread.",
      seoTitle: "Vegan Tamale Pie – Cornbread Casserole",
      slug: "vegan-tamale-pie-cornbread",
      excerpt: "",
      tags: [],
    },
    recipeCard: {
      name: "Vegan Tamale Pie",
      ingredients: ["2 cups masa harina", "1 tbsp olive oil"],
      steps: [{ text: "Heat the oil.", name: "" }],
      recipeYield: "8 servings",
      prepMinutes: 20,
      cookMinutes: 40,
      category: "Mains",
      cuisine: "Tex-Mex",
    },
  });

  check(
    tamale.seo.primaryCategory === "Tex-Mex",
    "Primary Category is Tex-Mex",
    tamale.seo.primaryCategory,
  );
  check(
    tamale.seo.otherCategories.join(", ") === "Mains, Super-Bowl",
    "Other Categories are Mains and Super-Bowl",
    tamale.seo.otherCategories.join(", "),
  );
  check(
    tamale.categories[0] === "Tex-Mex",
    "the exported list leads with the primary, which is what Yoast stores",
  );
  check(
    tamale.categories.length === 3,
    "and still carries every category",
    tamale.categories.join(", "),
  );
  check(
    !tamale.seo.otherCategories.includes("Tex-Mex"),
    "the primary is not repeated in the others",
  );

  const empty = splitCategories([]);
  check(
    empty.primary === "" && empty.others.length === 0,
    "no categories produces no primary and no others, never a guess",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nMeta description populates the excerpt");

  check(
    excerptFor(tamale, "") === tamale.seo.metaDescription,
    "the excerpt is the meta description",
  );
  check(
    excerptFor(tamale, "a different hand-written excerpt") ===
      tamale.seo.metaDescription,
    "and wins over a stored excerpt, so the two cannot disagree on a live post",
  );
  const noMeta = buildArticleDocument({
    title: "T",
    keyword: "k",
    content: "",
    editorial: { excerpt: "Only an excerpt exists." },
    recipeCard: {},
  });
  check(
    excerptFor(noMeta, "Only an excerpt exists.") === "Only an excerpt exists.",
    "with no meta description the stored excerpt is still used",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nThe recipe is immutable");

  const ingredients = [
    "2 tablespoons toasted sesame oil",
    "3 lb. Kabocha squash, seeded and diced",
    "2 teaspoons 5-spice",
    "15 oz. coconut milk, full fat",
  ];
  const steps = [
    { text: "Heat the oil in a large pot.", name: "" },
    { text: "Add the kabocha and cook 8 minutes.", name: "Simmer" },
  ];
  const doc = buildArticleDocument({
    title: "Kabocha Squash Soup",
    keyword: "kabocha squash soup",
    content: "<h2>Intro</h2><p>Hi.</p>",
    editorial: { seoDescription: "A sweet-spicy autumn bowl.", categories: ["Mains"] },
    recipeCard: {
      name: "Cozy Vegan Kabocha Squash Soup",
      ingredients,
      steps,
      recipeYield: "10 servings",
      prepMinutes: 15,
      cookMinutes: 40,
      customTimeLabel: "Chilling",
      customMinutes: 30,
      estimatedCost: "$14",
      equipment: ["Large pot", "Immersion blender"],
      tips: ["Toast the spices first."],
      openingSentence: "A bowl that tastes like October.",
      category: "Mains, Soups",
      cuisine: "Japanese",
      suitableForDiet: ["Vegan", "Gluten Free"],
    },
  });

  check(
    doc.recipeCard.ingredients.join("|") === ingredients.join("|"),
    "every ingredient line survives byte-for-byte, in the author's order",
  );
  check(
    doc.recipeCard.instructions.map((i) => i.text).join("|") ===
      steps.map((s) => s.text).join("|"),
    "instructions survive unedited and in order",
  );
  check(
    doc.recipeCard.ingredients[2] === "2 teaspoons 5-spice",
    "a number inside an ingredient is not parsed into anything",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nEvery recipe-card field the template asks for");

  const card = doc.recipeCard;
  check(card.title === "Cozy Vegan Kabocha Squash Soup", "Recipe title");
  check(card.recipeYield === "10 servings", "Yield");
  check(card.estimatedCost === "$14", "Estimated Cost");
  check(card.prepMinutes === 15, "Prep Time");
  check(card.customTimeLabel === "Chilling" && card.customMinutes === 30, "Custom Time");
  check(card.cookMinutes === 40, "Cook Time");
  check(card.totalMinutes === 85, "Total Time is derived, not stored", String(card.totalMinutes));
  check(card.course.join(",") === "Mains,Soups", "Courses", card.course.join(","));
  check(card.cuisine.join(",") === "Japanese", "Cuisine");
  check(card.diet.join(",") === "Vegan,Gluten Free", "Diet");
  check(card.openingSentence === "A bowl that tastes like October.", "Opening sentence");
  check(card.equipment.length === 2, "Equipment");
  check(card.ingredients.length === 4, "Ingredients");
  check(card.instructions.length === 2, "Instructions");
  check(card.tips.length === 1, "Tips");

  check(formatMinutes(85) === "1 hr 25 mins", "times render readably", formatMinutes(85));
  check(formatMinutes(0) === "", "an unset time renders as nothing, not '0 mins'");

  /* ------------------------------------------------------------------ */
  console.log("\nThe sections appear in the document itself");

  const cardHtml = renderRecipeCardSection(doc.recipeCard);
  check(cardHtml.includes(RECIPE_CARD_HEADING), "there is a Recipe Card section");
  for (const label of [
    "Yield",
    "Estimated Cost",
    "Prep Time",
    "Chilling",
    "Cook Time",
    "Total Time",
    "Courses",
    "Cuisine",
    "Diet",
    "Equipment",
    "Ingredients",
    "Instructions",
    "Tips",
  ]) {
    check(cardHtml.includes(label), `  the card shows ${label}`);
  }
  check(
    cardHtml.includes("2 teaspoons 5-spice"),
    "  and prints the ingredient exactly as written",
  );

  const seoHtml = renderSeoSection(doc.seo);
  check(seoHtml.includes(SEO_HEADING), "there is an SEO section");
  check(seoHtml.includes("SEO Meta description"), "  it shows the meta description");
  // This fixture has no slug, so the row must be absent — that is the point.
  check(!seoHtml.includes("URL slug"), "  an unset slug is omitted");
  check(
    renderSeoSection(tamale.seo).includes("vegan-tamale-pie-cornbread"),
    "  and a real slug is shown",
  );
  check(seoHtml.includes("Primary Category"), "  the primary category");
  check(renderSeoSection(tamale.seo).includes("Tex-Mex"), "  with the real value");
  check(
    renderSeoSection(tamale.seo).includes("Mains, Super-Bowl"),
    "  and the other categories",
  );

  const body = withDocumentSections("<h2>Intro</h2><p>Hi.</p>", doc);
  check(body.includes(RECIPE_CARD_HEADING), "both sections are appended to the body");
  check(body.includes(SEO_HEADING), "including the SEO one");

  const twice = withDocumentSections(body, doc);
  check(
    twice.split(RECIPE_CARD_HEADING).length === 2,
    "appending twice does not duplicate the card",
  );
  check(
    twice.split(SEO_HEADING).length === 2,
    "or the SEO section",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nNothing is invented");

  const bare = buildArticleDocument({
    title: "Bare",
    keyword: "",
    content: "",
    editorial: {},
    recipeCard: { ingredients: ["1 cup flour"], steps: [{ text: "Mix.", name: "" }] },
  });
  const bareHtml = renderRecipeCardSection(bare.recipeCard);
  check(!bareHtml.includes("Yield"), "an unstated yield is omitted, not guessed");
  check(!bareHtml.includes("Cook Time"), "an unstated cook time is omitted");
  check(!bareHtml.includes("Cuisine"), "an unstated cuisine is omitted");
  check(bareHtml.includes("1 cup flour"), "but what the author did write is there");
  check(
    renderSeoSection(bare.seo) === "",
    "an article with no SEO values renders no SEO section at all",
  );

  const noRecipe = buildArticleDocument({
    title: "Essay",
    keyword: "k",
    content: "<h2>A</h2><p>x</p>",
    editorial: {},
    recipeCard: {},
  });
  check(!hasRecipe(noRecipe.recipeCard), "an article with no recipe has no card");
  check(
    renderRecipeCardSection(noRecipe.recipeCard) === "",
    "and renders no Recipe Card section",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nSections are read off the body");

  check(
    tamale.sections.length === 2,
    "the body splits on its H2s",
    String(tamale.sections.length),
  );
  check(
    tamale.sections[0].heading === "🥰 Why you'll adore it",
    "and the heading keeps its emoji, which the export maps on",
    tamale.sections[0].heading,
  );
  check(tamale.h1 === tamale.title, "the H1 is the post title");
} finally {
  built.cleanup();
}

console.log(
  failures === 0 ? "\nAll ArticleDocument checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
