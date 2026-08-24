import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * Specialty ingredients — the shopping-aisle section.
 *
 * Not the ingredient list. The recipe card already holds every line; this
 * explains the handful a reader might get wrong, and is the second densest
 * place for internal links in the corpus.
 */
export const INGREDIENTS: SectionWriter = {
  key: "ingredients",

  purpose:
    "Explain only the items a reader might not have bought before, or might buy the wrong version of, and tell them what to do instead when the shop lets them down.",

  structure: `
H2 carrying a dish-specific emoji: "🌶️ [Dish] Ingredients", or a punny variant.
One sub-block per item you are given, in the order given, and no others.
Each sub-block: the item name as a bold mini-heading, then 2-4 sentences -
what it is, why it is in this recipe, what substitutes, and a warning where a
lookalike exists.
Where another recipe on this site uses the same item, name it in plain words.
`.trim(),

  voice: `
A friend standing in the aisle with you. Opinions are welcome and specific -
a preferred brand, a shop that stocks it, one that does not. Warnings are blunt
and say what goes wrong, not that something is "important".
Two or three sub-blocks carry a joke; the rest are straight. Substitutions only
when RECIPE_CONTEXT states them. If the paste does not offer a swap, say what
the ingredient is and stop. Do not invent coconut milk, wine, or a 'usual' sub.
`.trim(),

  devices: [
    "direct dismissal",
    "absurd escalation",
    "unexpected analogy",
    "weird personal aside",
  ],

  forbidden: [
    "Writing about an ingredient you were not asked to cover.",
    "Restating the ingredient list, or giving quantities. That is the recipe card's job.",
    "Explaining salt, oil, garlic, onion, flour or anything else a kitchen already has.",
    "Inventing a brand, a shop, a price or an availability claim.",
    "Offering a substitution the recipe does not support. An untested swap is a wrong one.",
    "A sentence that would fit any ingredient.",
  ],

  examples: [
    "**Masa Harina:** Masa harina is the ingredient that gives this topping that deeper, more complex corn flavor that regular cornmeal just cannot fully replicate. My absolute fave brand is Masienda. No masa harina? You can get away with just subbing in additional cornmeal in place of it.",
    "**The Chili:** Hold your hat. I mean for real - I use my vegan chili in a hat recipe as the base for this. I mean, of course I would prefer if you rocked a whole quart of that straight out of a frilly ladies hat with a ribbon, but we can't all have our dreams come true now, can we? Store-bought vegan chili works perfectly fine too if you need to move faster and not do every friggin' thing from scratch.",
    "**Young Green Jackfruit:** Whatever you do, do not accidentally grab the sweet ripe yellow jackfruit. That's a different thing entirely. Canned young green jackfruit is easy to find at any Asian grocery store, and many Whole Foods carry them too.",
    "**Fire Roasted Hatch Chiles:** I grab the small cans of these at Trader Joe's and it's a great way to add flavor without much heat. No TJ's? Fresh roasted poblanos work as a sub, or you can swap them out for a couple of tablespoons of minced chipotle peppers in adobo.",
  ],

  checklist: [
    "Have I written about exactly the items I was given, and nothing else?",
    "Does each sub-block say what to do if the reader cannot find it?",
    "Is every substitution one the recipe or the notes actually support?",
    "Have I named a brand or shop I was not told about? Remove it.",
    "Have I repeated any quantity from the recipe card? Remove it.",
  ],
};
