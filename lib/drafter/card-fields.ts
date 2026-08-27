/**
 * Recipe-card fields derived from what the article already knows.
 *
 * WP Recipe Maker warns about a card with no course, cuisine, keyword or
 * summary, and every card this product exported had all four empty. The
 * temptation is to have the model write them, which is exactly the thing that
 * must not happen: a cook time or a yield the author never stated is a false
 * claim published as structured data.
 *
 * So nothing here is generated. Every value is copied from something the
 * author or the pipeline already established:
 *
 *   Course   <- the categories chosen for the post
 *   Cuisine  <- a category that names a cuisine
 *   Keyword  <- the article's focus keyword
 *   Summary  <- the card's own opening sentence
 *
 * Times, yield, cost and equipment are deliberately absent. They exist only in
 * the author's head or their paste; anything else would be a guess, and the
 * control panel already shows them as missing so they can be typed in.
 *
 * A field the author has already filled is never overwritten.
 */

import type { RecipeCard } from "@/lib/drafter/recipe";

/**
 * Category names that describe a cuisine rather than a course.
 *
 * The client's taxonomy mixes both in one list — "Mains" and "Vegan Mexican
 * Recipes" are siblings — so they are told apart by name. Matching is on whole
 * words to avoid "Indianapolis" reading as Indian.
 */
const CUISINES = [
  "mexican", "italian", "thai", "indian", "chinese", "japanese", "korean",
  "vietnamese", "french", "greek", "spanish", "turkish", "lebanese",
  "moroccan", "ethiopian", "german", "british", "american", "cajun",
  "caribbean", "cuban", "filipino", "indonesian", "malaysian", "persian",
  "polish", "portuguese", "russian", "brazilian", "peruvian", "jewish",
  "middle eastern", "mediterranean", "tex-mex", "asian", "african",
  "southern", "hawaiian", "jamaican", "nordic", "swedish",
];

/** Course words, in the client's own vocabulary. */
const COURSES = [
  "mains", "main", "sides", "side", "appetizers", "appetizer", "starters",
  "desserts", "dessert", "breakfast", "brunch", "lunch", "dinner", "snacks",
  "snack", "soups", "soup", "salads", "salad", "drinks", "beverages",
  "sauces", "dressings", "breads", "bread", "condiments",
];

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "");
}

/**
 * True when the category name contains the term as whole words.
 *
 * Hyphens are treated as spaces on both sides: the client's taxonomy writes
 * "Vegan Tex Mex Recipes" while the canonical cuisine is "Tex-Mex", and a
 * match that depends on which one somebody typed is not a match.
 */
function names(category: string, term: string): boolean {
  const flat = (v: string) => v.replace(/-/g, " ");
  const w = words(flat(category));
  const t = flat(term).split(" ").filter((p) => p !== "");
  if (t.length === 1) return w.includes(t[0] ?? "");
  // Multi-word terms must appear as a contiguous run of whole words.
  return ` ${w.join(" ")} `.includes(` ${t.join(" ")} `);
}

/** The cuisine a category list implies, or "" when none does. */
export function cuisineFrom(categories: string[]): string {
  for (const category of categories) {
    for (const cuisine of CUISINES) {
      if (names(category, cuisine)) {
        // Title-case the cuisine itself, not the whole category name:
        // "Vegan Mexican Recipes" is a category, "Mexican" is the cuisine.
        return cuisine
          .split(/[\s-]/)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(cuisine.includes("-") ? "-" : " ");
      }
    }
  }
  return "";
}

/** The course(s) a category list implies, comma separated, or "". */
export function courseFrom(categories: string[]): string {
  const found: string[] = [];
  for (const category of categories) {
    for (const course of COURSES) {
      if (names(category, course)) {
        const label = category.trim();
        if (!found.includes(label)) found.push(label);
        break;
      }
    }
  }
  return found.join(", ");
}

/**
 * Fill the card's derivable fields from the article's own data.
 *
 * Returns a new card; the input is never mutated, and any field the author
 * already set is left exactly as it was.
 */
export function deriveCardFields(
  card: RecipeCard,
  source: { categories: string[]; focusKeyword: string },
): RecipeCard {
  const next = { ...card };

  if (next.category.trim() === "") {
    next.category = courseFrom(source.categories);
  }
  if (next.cuisine.trim() === "") {
    next.cuisine = cuisineFrom(source.categories);
  }
  if (next.keywords.trim() === "") {
    next.keywords = source.focusKeyword.trim();
  }
  // The card's summary is its opening sentence; WPRM reads the same field.
  if (next.openingSentence.trim() === "") {
    next.openingSentence = next.description.trim();
  }

  return next;
}
