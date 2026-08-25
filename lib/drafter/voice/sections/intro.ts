import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * Everything between the hook and the first H2.
 *
 * Training doc: 3-4 short paragraphs, each a different job, then 3-5 sibling
 * recipes named in plain words. Gold standard is Vegan Tamale Pie: history
 * with a wink, what you get when you slice it, the vegan swap without a
 * lecture, then the table it belongs on.
 *
 * Training examples that mention cookbooks, the food truck, or a daughter
 * are STYLE ONLY. Those facts are not true of the recipe being written
 * unless RECIPE_CONTEXT or RESEARCH_CONTEXT already contains them.
 */
export const INTRO: SectionWriter = {
  key: "intro",

  purpose:
    "Give the dish context and a reason to cook this version, then hand the reader somewhere to go. Sits below the first photo and above the first H2.",

  structure: `
3-4 paragraphs. Each is 2-4 sentences. Each does one job. Mix from these
blocks; you do not need all of them:

  - Background: where the dish comes from, or what people get wrong about it.
    History is one clause of fact from RESEARCH_CONTEXT, then one clause of
    comedy. If research has no history, skip this block. Do not invent one.
  - What this version is: layer by layer or component by component, named
    things, then a short fragment.
  - Why this version: the vegan swap stated without a lecture, or why it is
    easier than the reputation. No "this vegan recipe is completely plant-based".
  - Serving: 3-5 real recipes from SITE_CONTEXT, named the way you would say
    them out loud, inside the grammar of the sentence.

No heading. No bullet list. Do not start the method. A punchy "let's cook"
line is optional and only at the very end.
`.trim(),

  voice: `
Opinions are stated flatly and moved on from. Foreign and regional names are
used correctly and never explained down.
Sibling recipes sit mid-sentence in lower case, never as a title dropped
into a slot.
One parenthetical aside is welcome. A biography is not.
Pop-culture is in range when it is a mechanism (Beyoncé of squash, a TV
episode) and never when it is a fake memory of the author.
`.trim(),

  devices: [
    "absurd escalation",
    "contrast",
    "direct dismissal",
    "weird personal aside",
    "pop-culture reference",
    "punchy fragment",
  ],

  forbidden: [
    "Repeating anything the hook already said.",
    "Starting to give instructions. No temperatures, no timings, no method.",
    'Filler that says nothing: "this vegan recipe is completely plant-based".',
    "Cultural context written like a textbook, or exoticising the cuisine.",
    "Any anecdote, memory, cookbook, food truck, family, or restaurant claim that is not in the material you were given.",
    "Inventing a history, a princess, a celebrity quote, or a testing story.",
    "Health claims, including probiotics, nourishing, or gut benefits.",
    "Forcing a link into a sentence that does not want one.",
  ],

  examples: [
    "Tamale pies started showing up in Texas over 100 years ago, then went absolutely turnt in school cafeterias across America, which means somewhere out there is a 75-year-old still getting kinda emotional about lunch period. It's Tex-Mex comfort food royalty. The whole genius idea was to deliver all the slightly sweet corny glory of a real tamale without the part where you stand at the counter wrapping 47 tiny corn husk parcels like an unpaid tamale elf.",
    "I mean, I love me some vegan tamales, but this is different. It's gringo stuff, and I don't entirely mean that in a bad way.",
    "Slice into it and you'll see. You get: astonishingly moist and perfect cornbread up top, gooey melty cheese in the middle, meaty seitan and bean chili holding it all down. 3 textures. 1 fork. Beautiful chaos. Be still, m'heart.",
    "Serve it with some vegan chiles rellenos, calabacitas, or tofu tacos, and you just won yourself the plant-based Tex-Mex weeknight meal olympics with great ease. Like a wild tamale-eating sports goose.",
  ],

  checklist: [
    "Does every paragraph do a different job?",
    "Is there at least one sentence under 8 words?",
    "Have I named 3-5 real recipes from the list, inside normal sentences?",
    "Is every fact about the dish something I was actually given?",
    "If I wrote history, is it in RESEARCH_CONTEXT?",
    "Have I said anything about the author's life that was not given? Remove it.",
  ],
};
