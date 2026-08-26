/**
 * Which recipe-card fields are filled, and which WP Recipe Maker will complain
 * about.
 *
 * WPRM shows its own warning on the recipe list — "Recommended fields: Summary,
 * Servings, Times, Course, Cuisine, Keyword, Calories" — but only after the
 * post has been exported, which is far too late to be useful. The same answer
 * is available before anything is sent, from the card the author is looking at.
 *
 * Nutrition is deliberately absent: it is calculated by WPRM's own nutrition
 * tool from the ingredients, so an empty calorie count here is not a gap the
 * author should be asked to fill by hand.
 */

import type { RecipeCard } from "@/lib/drafter/recipe";

export type CardField = {
  key: string;
  label: string;
  /** What the author would see in the card, or "" when unset. */
  value: string;
  filled: boolean;
  /**
   * WPRM names these its recommended fields, and a post is weaker without
   * them. Everything else is genuinely optional.
   */
  recommended: boolean;
};

export type CardCompleteness = {
  fields: CardField[];
  filled: number;
  total: number;
  /** Recommended fields still empty — what WPRM would warn about. */
  missingRecommended: CardField[];
};

function minutes(value: number): string {
  if (value <= 0) return "";
  const hrs = Math.floor(value / 60);
  const mins = value % 60;
  const parts: string[] = [];
  if (hrs > 0) parts.push(`${String(hrs)} hr${hrs === 1 ? "" : "s"}`);
  if (mins > 0) parts.push(`${String(mins)} min${mins === 1 ? "" : "s"}`);
  return parts.join(" ");
}

function list(values: string[]): string {
  return values.filter((v) => v.trim() !== "").join(", ");
}

/**
 * Read the card as a list of labelled fields.
 *
 * Order follows the client's own recipe-card template, so the panel reads in
 * the same order as the thing it describes.
 */
export function cardCompleteness(recipe: RecipeCard): CardCompleteness {
  const raw: Omit<CardField, "filled">[] = [
    { key: "name", label: "Recipe title", value: recipe.name.trim(), recommended: true },
    {
      key: "summary",
      label: "Summary",
      value: (recipe.openingSentence.trim() || recipe.description.trim()),
      recommended: true,
    },
    { key: "yield", label: "Servings", value: recipe.recipeYield.trim(), recommended: true },
    { key: "cost", label: "Estimated cost", value: recipe.estimatedCost.trim(), recommended: false },
    { key: "prep", label: "Prep time", value: minutes(recipe.prepMinutes), recommended: true },
    {
      key: "custom",
      label: recipe.customTimeLabel.trim() || "Custom time",
      value: minutes(recipe.customMinutes),
      recommended: false,
    },
    { key: "cook", label: "Cook time", value: minutes(recipe.cookMinutes), recommended: true },
    { key: "course", label: "Course", value: recipe.category.trim(), recommended: true },
    { key: "cuisine", label: "Cuisine", value: recipe.cuisine.trim(), recommended: true },
    { key: "keywords", label: "Keyword", value: recipe.keywords.trim(), recommended: true },
    { key: "diet", label: "Diet", value: list(recipe.suitableForDiet), recommended: false },
    { key: "equipment", label: "Equipment", value: list(recipe.equipment), recommended: false },
    {
      key: "ingredients",
      label: "Ingredients",
      value:
        recipe.ingredients.length === 0
          ? ""
          : `${String(recipe.ingredients.length)} lines`,
      recommended: true,
    },
    {
      key: "instructions",
      label: "Instructions",
      value: recipe.steps.length === 0 ? "" : `${String(recipe.steps.length)} steps`,
      recommended: true,
    },
    { key: "tips", label: "Tips", value: list(recipe.tips), recommended: false },
  ];

  const fields: CardField[] = raw.map((f) => ({ ...f, filled: f.value !== "" }));

  return {
    fields,
    filled: fields.filter((f) => f.filled).length,
    total: fields.length,
    missingRecommended: fields.filter((f) => f.recommended && !f.filled),
  };
}
