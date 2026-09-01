/**
 * The WP Recipe Maker card, built from the author's own recipe.
 *
 * One rule outranks everything else in this file: the ingredient lines and the
 * method steps are the author's words and are sent character for character.
 * Nothing here parses "3 lb. Kabocha squash, seeded and diced" into an amount,
 * a unit and a name — that is inference, and inference on a recipe is how a
 * published post ends up telling someone to use three ounces of squash.
 *
 * The practical cost is that WPRM receives each ingredient as one unstructured
 * name. The card renders exactly as typed, and WPRM's automatic nutrition
 * works from matched ingredient rows, so it may decline to calculate. That is
 * reported honestly by the export rather than papered over: a wrong nutrition
 * panel is worse than none.
 *
 * Everything *around* the recipe — title, yield, times, course, cuisine, diet,
 * equipment — comes from the approved recipe metadata, which the author owns
 * in the Recipe tab.
 */

import type { RecipeCard } from "@/lib/drafter/recipe";

export type WprmIngredient = {
  /** The author's line, untouched. */
  name: string;
  amount: string;
  unit: string;
  notes: string;
};

export type WprmInstruction = { name: string; text: string };

export type WprmRecipePayload = {
  name: string;
  summary: string;
  servings: string;
  servings_unit: string;
  prep_time: number;
  cook_time: number;
  cost: string;
  /** Pressing, resting, chilling — WPRM adds it into the total. */
  custom_time: number;
  /** The card's own tips, which WPRM renders under the instructions. */
  notes: string;
  ingredients: WprmIngredient[];
  instructions: WprmInstruction[];
  equipment: string[];
  course: string[];
  cuisine: string[];
  keyword: string[];
  suitablefordiet: string[];
};

/**
 * Splits a yield like "10 servings" into the number and its unit.
 *
 * This is the one place a value is taken apart, and it is safe to: the yield
 * is a WPRM field that is stored as two columns whatever we do, and getting it
 * wrong changes a label rather than a quantity of food. A yield that does not
 * start with a number is passed through whole as the unit.
 */
export function splitYield(value: string): { servings: string; unit: string } {
  const text = value.trim();
  const m = /^([\d./\s-]+)\s*(.*)$/.exec(text);
  if (m === null || m[1] === undefined || m[1].trim() === "") {
    return { servings: "", unit: text };
  }
  return { servings: m[1].trim(), unit: (m[2] ?? "").trim() };
}

/** Schema.org diet values, as WPRM's taxonomy stores them. */
const DIET_LABELS: Record<string, string> = {
  vegan: "Vegan",
  vegandiet: "Vegan",
  vegetarian: "Vegetarian",
  vegetariandiet: "Vegetarian",
  glutenfree: "Gluten Free",
  glutenfreediet: "Gluten Free",
  lowcalorie: "Low Calorie",
  lowfat: "Low Fat",
  lowsalt: "Low Salt",
  lowlactose: "Low Lactose",
  diabetic: "Diabetic",
  halal: "Halal",
  hindu: "Hindu",
  kosher: "Kosher",
};

function dietLabel(value: string): string {
  const key = value.toLowerCase().replace(/[^a-z]/g, "");
  return DIET_LABELS[key] ?? value.trim();
}

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Whether there is enough of a recipe to build a card at all.
 *
 * WPRM will happily save a card with no rows in it, and an empty recipe card
 * on a published post is worse than no card, so the export refuses instead.
 */
export function hasRecipeContent(card: RecipeCard): boolean {
  return (
    card.ingredients.some((i) => i.trim() !== "") &&
    card.steps.some((s) => s.text.trim() !== "")
  );
}

export function buildRecipePayload(
  card: RecipeCard,
  opts: { title: string; equipment?: string[] } = { title: "" },
): WprmRecipePayload | null {
  if (!hasRecipeContent(card)) return null;

  const { servings, unit } = splitYield(card.recipeYield);

  return {
    name: card.name.trim() || opts.title.trim(),
    /*
     * The same sentence the document prints as Summary.
     *
     * The document showed `openingSentence` and the card was sent
     * `description`, so an author who wrote the card's opening line watched it
     * reach the document and never reach WordPress.
     */
    summary: card.openingSentence.trim() || card.description.trim(),
    servings,
    servings_unit: unit,
    prep_time: card.prepMinutes > 0 ? card.prepMinutes : 0,
    cook_time: card.cookMinutes > 0 ? card.cookMinutes : 0,

    /*
     * Cost, custom time and notes were being dropped on the floor.
     *
     * The connector has accepted all three since 1.5.0 and computes the total
     * time from prep + cook + custom, so the loss was entirely on this side:
     * the client's own lasagna card says "$18" and his torta card says
     * "Pressing: 10 minutes", and neither reached the site. Nothing here is
     * derived or guessed — each is a field the author filled in, passed
     * through, and an empty one stays empty.
     */
    cost: card.estimatedCost.trim(),
    custom_time: card.customMinutes > 0 ? card.customMinutes : 0,
    notes: card.tips
      .map((t) => t.trim())
      .filter((t) => t !== "")
      .join("\n"),

    // Verbatim. See the note at the top of this file.
    ingredients: card.ingredients
      .filter((line) => line.trim() !== "")
      .map((line) => ({ name: line.trim(), amount: "", unit: "", notes: "" })),

    instructions: card.steps
      .filter((step) => step.text.trim() !== "")
      .map((step) => ({ name: step.name.trim(), text: step.text.trim() })),

    // An explicit list wins; otherwise the card's own equipment is used.
    equipment: (opts.equipment ?? card.equipment).filter((e) => e.trim() !== ""),
    course: card.category.trim() === "" ? [] : commaList(card.category),
    cuisine: card.cuisine.trim() === "" ? [] : commaList(card.cuisine),
    keyword: card.keywords.trim() === "" ? [] : commaList(card.keywords),
    suitablefordiet: card.suitableForDiet.map(dietLabel).filter((d) => d !== ""),
  };
}
