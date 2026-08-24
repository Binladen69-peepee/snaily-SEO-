import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * The recipe card's opening sentence.
 *
 * One or two lines at the top of the printable card, and the last piece of
 * voice before the post turns into a list of quantities. Everything else on the
 * card is the author's own data and is never written by a model.
 */
export const RECIPE_CARD: SectionWriter = {
  key: "recipe-card",

  purpose:
    "Sell the recipe in one or two lines at the top of the card, for someone who scrolled straight past the post.",

  structure: `
1-2 sentences. That is the whole task.
Never instructional. Never repeats the recipe's title back.
No heading, no formatting, no links.
`.trim(),

  voice: `
Confident and a little chaotic. It can be a claim about the dish, a promise
about what happens after you make it, or a flat statement of what it is - but
it has to have a spine. The card's sentence is often the punchiest line on the
page precisely because it has no room to explain itself.
`.trim(),

  devices: ["playful exaggeration", "punchy fragment", "contrast", "absurd escalation"],

  forbidden: [
    "Instructions of any kind.",
    "Repeating the recipe title.",
    "Listing ingredients.",
    "Any claim about testing, history or popularity.",
    "Generic adjectives standing in for a real detail.",
  ],

  examples: [
    "A 100-year-old Tex-Mex comfort food classic that somehow only gets better when you take the animals out of it. Make it once and it's in the permanent rotation whether you planned that or not.",
    "Toasted bolillo, hot vegan chorizo, beans, fresh crunch, optional guajillo sauce because you love giving yourself the messiest, most flavorful sandos in the galaxy. This vegan torta de chorizo is filling AF and not meant to be eaten politely or quietly.",
    "A wee bit citrusy, juicy and tender as all get out, these jackfruit carnitas tacos serve up street food energy without a meat truck in sight.",
    "This vegan mole poblano has so many chiles and nuts in it that it really opens up new dimensions in the chocolate flavor portal.",
  ],

  checklist: [
    "Is it two sentences or fewer?",
    "Does it avoid repeating the title?",
    "Is there one specific detail rather than a stack of adjectives?",
    "Have I told anyone to do anything? Rewrite it.",
  ],
};
