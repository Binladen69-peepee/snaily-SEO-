/**
 * The two rules that outrank sounding good.
 *
 * A model asked to "sound personal" writes a biography. It will say the author
 * first ate this in a market in Oaxaca, that a thousand testers made it, that
 * it was on the food truck menu for years — all plausible, all invented, and
 * all published under a real person's name on their real site.
 *
 * Voice comes from phrasing. Facts come from sources. These are separate, and
 * the prompts say so in the imperative rather than hoping it is implied.
 */

export const NEVER_INVENT = `
NEVER INVENT A FACT ABOUT THIS AUTHOR OR THIS RECIPE.

Not permitted unless it appears verbatim in the material you were given:
- personal anecdotes, memories or stories
- where or when the author ate, cooked or learned something
- the food truck, the restaurant, the cookbook, classes, travel
- family, friends, customers, neighbours
- how many people tested the recipe, or where they are
- that the author tried another version, an earlier version, or a failure
- awards, press, popularity, sales, rankings
- how long a recipe has been on the site or how often it is made
- tester locations, cities, countries, or "from X to Y" geography
- "I tried…", family anecdotes, cookbook history, restaurant memories
- claims about what readers or testers sent, said, or raved about
- an origin story, inventor, cafeteria, city, or "some person once" for the
  dish, unless that origin already appears in RESEARCH_CONTEXT

"Sound personal" means the phrasing of an opinion, not a biography. An opinion
about the food in front of you is always allowed: what you would serve it with,
what annoys you about the usual version, what you would skip. A memory is not.

If a sentence would need a fact you were not given, write a different sentence.
`.trim();

export const GROUNDING = `
THE RECIPE IS THE ONLY SOURCE OF TRUTH ABOUT THE RECIPE.

- Every ingredient you name must be in the ingredient list you were given.
- Every quantity, time and temperature must match it exactly.
- Never add an ingredient because the dish usually has one. If the recipe has
  no coconut milk, there is no coconut milk. If it has no wine, there is none.
- Substitutions may only be offered where the recipe or the given notes state
  them. "You could use X instead" is a claim, and an untested one is a wrong one.
- An FAQ answer may not introduce an ingredient, a method or a timing that is
  not in the recipe.
- Other recipes on this site may be named only from the list you are given.
  Never invent a recipe title, and never describe a recipe you cannot see.

Where you do not have the information, say less. A shorter true sentence beats
a longer invented one, every time.
`.trim();

/** Both rules, for a system prompt. */
export const HARD_CONSTRAINTS = `${NEVER_INVENT}\n\n${GROUNDING}`;

/**
 * Phrases that almost always mark an invented biography.
 *
 * Used by the style check as a detector rather than as prompt text: they are
 * the openings a model writes when it has decided to have a memory. A hit is a
 * strong signal and not proof, so the check reports the sentence rather than
 * deleting it.
 */
export const INVENTED_CLAIM_MARKERS = [
  "i first",
  "i grew up",
  "i remember",
  "back when i",
  "years ago i",
  "when i was",
  "my grandmother",
  "my grandma",
  "my mother used",
  "my mom used",
  "my dad used",
  "on our food truck",
  "at our restaurant",
  "in my cookbook",
  "in my first cookbook",
  "when i lived",
  "on a trip to",
  "during my time in",
  "i learned this",
  "i was taught",
  "a reader wrote",
  "one of my students",
  "my neighbour",
  "my neighbor",
  "testers in",
  "recipe testers told",
  "over the years i",
  "the first time i",
  "i used to make",
  "i've been making this for",
  "has been on the blog",
  "our most popular",
  "readers tell me",
  "everyone who tries",
  "i tried this",
  "i tried it",
  "when i tested",
  "home cooks from",
  "sent in rave",
  "rave notes",
  "from berlin",
  "to portland",
  "across america have",
  "around the world have told",
  "my testers in",
];

/**
 * Testing claims the author does make, verbatim, in their own posts.
 *
 * The "Tested and Approved Worldwide" line is part of the documented format,
 * so it is not an invented claim — but only in the wording the site already
 * uses. Anything more specific than these is fabrication.
 */
export const ALLOWED_TESTING_CLAIMS = [
  "tested and approved worldwide",
  "recipe testers",
  "a global team of testers",
  "over 1,000 home cooks",
  "over 1000 recipe testers",
  "a team of hundreds of recipe testers",
];
