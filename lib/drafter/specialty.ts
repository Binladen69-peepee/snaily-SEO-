/**
 * Choosing which ingredients are worth a paragraph.
 *
 * The Specialty Ingredients section exists to explain the things a reader
 * might not have bought before — kabocha, masa harina, young green jackfruit —
 * and to say what to use instead. It is not a second copy of the recipe card.
 *
 * It kept becoming one. Every writing call is handed the full ingredient list
 * under the instruction "source of truth, do not add or drop any", which is
 * exactly right when describing the method and exactly wrong when choosing
 * what to write about: a soup with fifteen lines came back with fifteen
 * sub-blocks, one of them about celery. So the choosing is done here, and the
 * model is told which items to cover rather than being trusted to pick.
 */

/**
 * Things that live in a normal kitchen already.
 *
 * Deliberately broad. A false negative costs the reader one paragraph they did
 * not need; a false positive prints "Salt: salt is salty" on a published post.
 */
const PANTRY = new Set([
  "water", "salt", "sea salt", "kosher salt", "black pepper", "pepper",
  "olive oil", "oil", "vegetable oil", "canola oil", "sunflower oil",
  "sugar", "brown sugar", "granulated sugar", "powdered sugar",
  "flour", "all purpose flour", "all-purpose flour", "plain flour",
  "baking powder", "baking soda", "cornstarch", "corn starch",
  "garlic", "garlic clove", "garlic cloves", "onion", "yellow onion",
  "red onion", "white onion", "shallot", "celery", "carrot", "carrots",
  "potato", "potatoes", "tomato", "tomatoes", "lemon", "lime", "lemon juice",
  "lime juice", "orange juice", "parsley", "cilantro", "coriander",
  "basil", "thyme", "oregano", "rosemary", "bay leaf", "bay leaves",
  "cumin", "paprika", "smoked paprika", "cinnamon", "nutmeg", "ginger",
  "chili powder", "red pepper flakes", "vanilla", "vanilla extract",
  "maple syrup", "apple cider vinegar", "white vinegar", "rice vinegar",
  "soy sauce", "tamari", "nutritional yeast", "corn", "peas", "spinach",
  "mushrooms", "scallion", "scallions", "green onion", "green onions",
  "vegetable broth", "vegetable stock", "broth", "stock", "plant based milk",
  "plant-based milk", "almond milk", "soy milk", "oat milk", "coconut milk",
  "vegan butter", "olive", "olives", "walnuts", "pecans", "almonds",
  "cashews", "sesame seeds", "chickpeas", "black beans", "pinto beans",
  "white beans", "rice", "brown rice", "white rice", "pasta", "bread",
  "breadcrumbs", "panko", "cornmeal", "sesame oil", "toasted sesame oil",
]);

/** Units and pack words that sit between the amount and the ingredient. */
const UNITS =
  /^(?:cups?|tablespoons?|teaspoons?|tbsp?|tsp?|ounces?|oz|pounds?|lbs?|grams?|g|kilograms?|kg|milliliters?|ml|liters?|litres?|l|cloves?|cans?|jars?|packages?|packets?|bunch(?:es)?|heads?|stalks?|sprigs?|slices?|pieces?|pinch(?:es)?|dash(?:es)?|handfuls?|quarts?|pints?|sticks?|large|medium|small)\b/i;

const LEADING_AMOUNT = /^[\s\d¼½¾⅓⅔⅛⅜⅝⅞./x×+-]+/;

/** A number that belongs to the ingredient's name: 5-spice, 7-grain. */
const GLUED_NUMBER = /^\d+-\p{L}/u;

/**
 * The ingredient's name, with the amount, unit and prep note taken off.
 *
 * "1 ¼ cups shredded vegan cheddar, at room temperature" becomes
 * "shredded vegan cheddar". Everything after the first comma goes, because on
 * this site that is reliably the preparation rather than the ingredient.
 */
export function ingredientName(line: string): string {
  let text = line.trim().replace(/\([^)]*\)/g, " ");

  // Amount, then optionally a unit, then optionally a second amount ("1 (14 oz) can").
  for (let pass = 0; pass < 2; pass += 1) {
    // A digit glued to a word by a hyphen is part of the name, not an amount:
    // "2 teaspoons 5-spice" was arriving as "spice".
    if (GLUED_NUMBER.test(text)) break;
    text = text.replace(LEADING_AMOUNT, "").trimStart();
    const unit = UNITS.exec(text);
    if (unit === null) break;
    text = text.slice(unit[0].length).trimStart();
    if (!/^[\s\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(text)) break;
  }

  return text
    .split(",")[0]!
    .replace(/\b(?:of|the)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A letter outside basic Latin - the mark of an imported name. */
const NON_ASCII = /[^\u0000-\u007F]/;

/** Prep words that describe handling rather than identity. */
const PREP =
  /\b(?:chopped|diced|minced|sliced|shredded|grated|crushed|drained|rinsed|peeled|cooked|raw|fresh|frozen|dried|ground|melted|softened|packed|divided|room temperature|finely|roughly|thinly|toasted|roasted)\b/gi;

function core(name: string): string {
  return name.replace(PREP, " ").replace(/\s+/g, " ").trim();
}

/**
 * Whether this is a pantry item wearing an adjective.
 *
 * The plain list catches "vegetable stock" and misses "unsalted vegetable
 * stock"; it catches "potato" and misses "russet potato". Both of those were
 * chosen for the Kabocha soup's specialty section, which is not what a reader
 * needs a paragraph about. So the tail of the name is checked as well as the
 * whole of it — "kabocha squash" survives because "squash" is not on the list,
 * which is the distinction that matters.
 */
function isPantry(name: string): boolean {
  if (PANTRY.has(name)) return true;

  const words = name.split(" ").filter(Boolean);
  for (let take = 1; take <= 2 && take < words.length; take += 1) {
    if (PANTRY.has(words.slice(words.length - take).join(" "))) return true;
  }
  return false;
}

/**
 * How interesting an ingredient is to a reader who has not cooked this before.
 *
 * Nothing clever, and deliberately explainable: a name the pantry list does not
 * know, that is not one bare common word, and that carries a mark of somewhere
 * else — a diacritic, or a second word doing real work — is the kind of thing
 * the section exists for.
 */
function score(name: string): number {
  let points = 1;

  // Only used to break ties when more than `max` items survive the pantry
  // filter, so it stays blunt on purpose.
  if (NON_ASCII.test(name)) points += 2;
  if (name.split(" ").filter(Boolean).length >= 2) points += 1;
  if (/\b(?:vegan|plant-based|gluten-free)\b/.test(name)) points -= 1;

  return points;
}

export type SpecialtyPick = { name: string; line: string };

/**
 * The ingredients worth explaining, in the order the recipe lists them.
 *
 * Capped, because the section is meant to be read. Six sub-blocks is already
 * the long end of what the client's own posts run to.
 */
export function selectSpecialtyIngredients(
  lines: string[],
  max = 6,
): SpecialtyPick[] {
  const seen = new Set<string>();
  const candidates: { pick: SpecialtyPick; score: number; order: number }[] = [];

  lines.forEach((line, order) => {
    const name = core(ingredientName(line));
    if (name === "" || name.length < 3) return;
    if (seen.has(name)) return;
    if (isPantry(name)) return;

    seen.add(name);
    candidates.push({ pick: { name, line: line.trim() }, score: score(name), order });
  });

  return candidates
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max)
    .sort((a, b) => a.order - b.order)
    .map((c) => c.pick);
}
