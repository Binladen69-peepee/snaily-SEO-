/**
 * Recipe structured data.
 *
 * Google reads Recipe JSON-LD for rich results, the recipe carousel and, since
 * 2025, AI Overviews. Nothing here is generated or guessed: every field is
 * typed by the author in the recipe panel, and a field left blank is simply
 * omitted from the output rather than filled with a plausible default. A
 * fabricated cook time in structured data is a factual claim to Google about
 * a real dish.
 *
 * Shape follows schema.org/Recipe as Google documents it: ingredients as
 * individual `recipeIngredient` strings, steps as `HowToStep` objects, and
 * durations as ISO-8601.
 */

export type RecipeStep = {
  text: string;
  /** Optional short label, becomes HowToStep.name. */
  name: string;
};

export type RecipeCard = {
  /** Empty = no recipe on this article, and no JSON-LD is emitted. */
  name: string;
  description: string;
  /** Absolute URL. Falls back to the article's featured image in the panel. */
  imageUrl: string;
  author: string;
  /** Minutes. 0 = not set. */
  prepMinutes: number;
  cookMinutes: number;
  /** e.g. "9 cups", "12 cookies". Required for rich results. */
  recipeYield: string;
  /** e.g. "Dessert". */
  category: string;
  /** e.g. "American". */
  cuisine: string;
  /** e.g. "vegan, gluten-free". */
  keywords: string;
  /** One per line in the panel, one entry each in the output. */
  ingredients: string[];
  steps: RecipeStep[];
  /** Per serving. 0 / empty = omitted. */
  calories: number;
  suitableForDiet: string[];

  /*
   * The remaining fields on the client's recipe-card template. Every one is
   * author-supplied: none is inferred from the prose, because a card that
   * guesses a cook time is worse than a card that leaves it blank.
   */
  /** Free text, e.g. "$12". Empty = not stated. */
  estimatedCost: string;
  /** A named extra time, e.g. "Chilling". Minutes in `customMinutes`. */
  customTimeLabel: string;
  customMinutes: number;
  /** Kit the cook needs, one per line. */
  equipment: string[];
  /** Card tips, distinct from the article's Top Tips section. */
  tips: string[];
  /** The card's opening sentence, shown above the ingredients. */
  openingSentence: string;
};

export const EMPTY_RECIPE: RecipeCard = {
  name: "",
  description: "",
  imageUrl: "",
  author: "",
  prepMinutes: 0,
  cookMinutes: 0,
  recipeYield: "",
  category: "",
  cuisine: "",
  keywords: "",
  ingredients: [],
  steps: [],
  calories: 0,
  suitableForDiet: [],
  estimatedCost: "",
  customTimeLabel: "",
  customMinutes: 0,
  equipment: [],
  tips: [],
  openingSentence: "",
};

/** schema.org diet URLs Google recognises. */
export const DIETS = [
  "VeganDiet",
  "VegetarianDiet",
  "GlutenFreeDiet",
  "LowLactoseDiet",
  "LowCalorieDiet",
  "LowFatDiet",
  "LowSaltDiet",
  "DiabeticDiet",
  "HalalDiet",
  "KosherDiet",
] as const;

export function parseRecipe(value: unknown): RecipeCard {
  if (value === null || typeof value !== "object") return { ...EMPTY_RECIPE };
  const v = value as Partial<RecipeCard>;

  const str = (x: unknown): string => (typeof x === "string" ? x : "");
  const num = (x: unknown): number =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0;
  const strList = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];

  return {
    name: str(v.name),
    description: str(v.description),
    imageUrl: str(v.imageUrl),
    author: str(v.author),
    prepMinutes: num(v.prepMinutes),
    cookMinutes: num(v.cookMinutes),
    recipeYield: str(v.recipeYield),
    category: str(v.category),
    cuisine: str(v.cuisine),
    keywords: str(v.keywords),
    ingredients: strList(v.ingredients),
    steps: Array.isArray(v.steps)
      ? v.steps
          .filter((s): s is RecipeStep => s !== null && typeof s === "object")
          .map((s) => ({ text: str(s.text), name: str(s.name) }))
          .filter((s) => s.text !== "")
      : [],
    calories: num(v.calories),
    suitableForDiet: strList(v.suitableForDiet),
    estimatedCost: str(v.estimatedCost),
    customTimeLabel: str(v.customTimeLabel),
    customMinutes: num(v.customMinutes),
    equipment: strList(v.equipment),
    tips: strList(v.tips),
    openingSentence: str(v.openingSentence),
  };
}

/** Minutes → ISO-8601 duration. 90 → "PT1H30M". */
export function isoDuration(minutes: number): string {
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h > 0 ? `${String(h)}H` : ""}${m > 0 ? `${String(m)}M` : ""}`;
}

export type RecipeIssue = {
  field: string;
  severity: "error" | "warning";
  message: string;
};

/**
 * What Google requires versus what merely helps.
 *
 * `name` and `image` are hard requirements for a rich result. `recipeYield`
 * is the third field the recipe-schema guidance treats as essential, and
 * times, ingredients, steps and nutrition are the ones that measurably lift
 * click-through.
 */
export function validateRecipe(recipe: RecipeCard): RecipeIssue[] {
  const issues: RecipeIssue[] = [];
  if (recipe.name.trim() === "") {
    return [
      {
        field: "name",
        severity: "error",
        message: "Give the recipe a name to turn on structured data.",
      },
    ];
  }

  if (recipe.imageUrl.trim() === "") {
    issues.push({
      field: "imageUrl",
      severity: "error",
      message: "An image URL is required for a recipe rich result.",
    });
  } else if (!/^https?:\/\//i.test(recipe.imageUrl.trim())) {
    issues.push({
      field: "imageUrl",
      severity: "error",
      message: "The image must be an absolute URL — Google cannot fetch a relative path.",
    });
  }

  if (recipe.recipeYield.trim() === "") {
    issues.push({
      field: "recipeYield",
      severity: "error",
      message: "Yield (servings) is required for a recipe rich result.",
    });
  }

  if (recipe.ingredients.length === 0) {
    issues.push({
      field: "ingredients",
      severity: "warning",
      message: "No ingredients listed. Google shows these in the rich result.",
    });
  }
  if (recipe.steps.length === 0) {
    issues.push({
      field: "steps",
      severity: "warning",
      message: "No method steps. These power the step-by-step rich result.",
    });
  }
  if (recipe.prepMinutes === 0 && recipe.cookMinutes === 0) {
    issues.push({
      field: "times",
      severity: "warning",
      message: "No prep or cook time. Times are among the fields that lift click-through.",
    });
  }
  if (recipe.calories === 0) {
    issues.push({
      field: "calories",
      severity: "warning",
      message: "No calorie figure. Optional, but it appears in the rich result when present.",
    });
  }
  if (recipe.author.trim() === "") {
    issues.push({
      field: "author",
      severity: "warning",
      message: "No author. Recommended for recipe structured data.",
    });
  }

  return issues;
}

/** True when there is enough to emit anything at all. */
export function hasRecipe(recipe: RecipeCard): boolean {
  return recipe.name.trim() !== "";
}

type JsonLd = Record<string, unknown>;

/**
 * schema.org Recipe as JSON-LD.
 *
 * Empty fields are dropped rather than emitted blank: `"cookTime": ""` is
 * invalid structured data, and a zero would be a claim the author never made.
 */
export function recipeJsonLd(
  recipe: RecipeCard,
  context: { url?: string; datePublished?: string } = {},
): JsonLd | null {
  if (!hasRecipe(recipe)) return null;

  const out: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.name.trim(),
  };

  const put = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" && value.trim() === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    out[key] = value;
  };

  put("description", recipe.description.trim());
  put("image", recipe.imageUrl.trim() === "" ? "" : [recipe.imageUrl.trim()]);
  if (recipe.author.trim() !== "") {
    out.author = { "@type": "Person", name: recipe.author.trim() };
  }
  put("datePublished", context.datePublished);
  put("url", context.url);
  put("prepTime", isoDuration(recipe.prepMinutes));
  put("cookTime", isoDuration(recipe.cookMinutes));
  put("totalTime", isoDuration(recipe.prepMinutes + recipe.cookMinutes));
  put("recipeYield", recipe.recipeYield.trim());
  put("recipeCategory", recipe.category.trim());
  put("recipeCuisine", recipe.cuisine.trim());
  put("keywords", recipe.keywords.trim());
  put(
    "recipeIngredient",
    recipe.ingredients.map((i) => i.trim()).filter((i) => i !== ""),
  );

  const steps = recipe.steps
    .filter((s) => s.text.trim() !== "")
    .map((s) => {
      const step: JsonLd = { "@type": "HowToStep", text: s.text.trim() };
      if (s.name.trim() !== "") step.name = s.name.trim();
      return step;
    });
  put("recipeInstructions", steps);

  if (recipe.calories > 0) {
    out.nutrition = {
      "@type": "NutritionInformation",
      calories: `${String(recipe.calories)} calories`,
    };
  }

  put(
    "suitableForDiet",
    recipe.suitableForDiet.map((d) => `https://schema.org/${d}`),
  );

  return out;
}

/**
 * The JSON-LD as a script tag, ready to append to exported HTML.
 *
 * `<` is escaped so a stray "</script>" inside a field cannot close the tag
 * early and turn recipe text into live markup on the published page.
 */
export function recipeScriptTag(
  recipe: RecipeCard,
  context: { url?: string; datePublished?: string } = {},
): string {
  const data = recipeJsonLd(recipe, context);
  if (data === null) return "";
  const json = JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
