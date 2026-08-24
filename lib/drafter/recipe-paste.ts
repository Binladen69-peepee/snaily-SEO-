/**
 * Reading the author's pasted recipe.
 *
 * Deliberately not a model call. Ingredients, quantities, times and
 * temperatures are the one part of a recipe post that must be exactly what the
 * author wrote — a model asked to "tidy" a paste will helpfully round 18
 * minutes to 20, or add the salt it expects to see. So the split is done with
 * ordinary parsing, and anything this cannot determine comes back empty rather
 * than guessed.
 *
 * The steps this produces are what the writing stage is allowed to describe,
 * and the count is what the WordPress template's step columns are sized from.
 */

export type ParsedRecipe = {
  ingredients: string[];
  steps: string[];
  /** Lines that are neither, kept so nothing the author pasted is silently lost. */
  notes: string[];
  /** True when the paste had explicit ingredient and instruction sections. */
  sectioned: boolean;
};

const INGREDIENT_HEADING = /^\s*#{0,3}\s*(?:\*\*)?\s*ingredients?\b/i;
const INSTRUCTION_HEADING =
  /^\s*#{0,3}\s*(?:\*\*)?\s*(?:instructions?|method|directions?|steps?|how to make|preparation)\b/i;
const OTHER_HEADING =
  /^\s*#{0,3}\s*(?:\*\*)?\s*(?:notes?|equipment|yield|serves|prep time|cook time|total time|nutrition|tips?)\b/i;

/** "1. ", "1) ", "Step 3:", "- ", "* ", "• " */
const LIST_MARKER = /^\s*(?:[-*•‣]|\d{1,2}[.)]|step\s+\w+\s*[:.]?)\s+/i;

/**
 * A line that looks like an ingredient.
 *
 * Quantity-led is the strongest signal and it is what the client's pastes use.
 * Kept conservative on purpose: a misfiled line lands in `notes`, which is
 * visible, rather than becoming a step the article then describes.
 */
const QUANTITY_LED =
  /^\s*(?:[-*•]\s*)?(?:\d+[\d\s./⁄½⅓⅔¼¾⅛]*|½|⅓|⅔|¼|¾|⅛|a\s+few|a\s+pinch|pinch|dash|handful)\b/i;

function clean(line: string): string {
  return line
    .replace(/^\s*[-*•‣]\s+/, "")
    .replace(/^\s*\d{1,2}[.)]\s+/, "")
    .replace(/^\s*step\s+\w+\s*[:.]\s*/i, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
}

/**
 * Splits the paste.
 *
 * Two passes: explicit headings when the author used them, and a shape-based
 * fallback when they did not. The fallback leans on the fact that an
 * ingredient line is short and starts with a quantity while a step line is a
 * sentence — which is true of every paste this has been run against, and when
 * it is not, the result is a step in `notes`, not an invented one.
 */
export function parseRecipePaste(paste: string): ParsedRecipe {
  const lines = paste
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");

  const ingredients: string[] = [];
  const steps: string[] = [];
  const notes: string[] = [];

  let section: "none" | "ingredients" | "steps" | "other" = "none";
  let sectioned = false;

  for (const raw of lines) {
    if (INGREDIENT_HEADING.test(raw)) {
      section = "ingredients";
      sectioned = true;
      continue;
    }
    if (INSTRUCTION_HEADING.test(raw)) {
      section = "steps";
      sectioned = true;
      continue;
    }
    if (OTHER_HEADING.test(raw)) {
      section = "other";
      notes.push(clean(raw));
      continue;
    }

    const text = clean(raw);
    if (text === "") continue;

    if (section === "ingredients") {
      ingredients.push(text);
      continue;
    }
    if (section === "steps") {
      steps.push(text);
      continue;
    }
    if (section === "other") {
      notes.push(text);
      continue;
    }

    // No headings in this paste. Decide by shape.
    const words = text.split(/\s+/).length;
    if (QUANTITY_LED.test(raw) && words <= 14) {
      ingredients.push(text);
    } else if (LIST_MARKER.test(raw) || words > 6) {
      steps.push(text);
    } else {
      notes.push(text);
    }
  }

  return { ingredients, steps, notes, sectioned };
}

export type RecipeIssue = { code: string; message: string };

/** Reasons the paste cannot be drafted from. Empty means it is usable. */
export function validateRecipePaste(parsed: ParsedRecipe): RecipeIssue[] {
  const issues: RecipeIssue[] = [];

  if (parsed.ingredients.length === 0) {
    issues.push({
      code: "no-ingredients",
      message:
        "No ingredients found in the paste. Add an “Ingredients” heading above the list so nothing is guessed.",
    });
  }

  if (parsed.steps.length === 0) {
    issues.push({
      code: "no-steps",
      message:
        "No instructions found in the paste. Add an “Instructions” heading above the method.",
    });
  }

  return issues;
}

/**
 * How the steps are handed to the writing stage.
 *
 * Numbered, so the model's step headings line up one-for-one with the paste and
 * the template mapper can put step three's prose in step three's column.
 */
export function formatSteps(parsed: ParsedRecipe): string {
  return parsed.steps.map((s, i) => `${String(i + 1)}. ${s}`).join("\n");
}

export function formatIngredients(parsed: ParsedRecipe): string {
  return parsed.ingredients.map((s) => `- ${s}`).join("\n");
}
