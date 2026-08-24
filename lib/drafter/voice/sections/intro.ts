import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * Everything between the hook and the first H2.
 *
 * Where the post earns the reader's patience: what the dish is, where it comes
 * from, why this version, and what to eat it with. It is also the first place
 * internal links appear.
 */
export const INTRO: SectionWriter = {
  key: "intro",

  purpose:
    "Give the dish context and a reason to trust this version, then hand the reader somewhere to go. Sits below the first photo and above the first H2.",

  structure: `
2-4 short paragraphs, each doing one job, in roughly this order:
  - where the dish comes from, or what people usually get wrong about it
  - what this version actually is, layer by layer or component by component
  - what makes it worth making, including the vegan swap, stated without a lecture
  - what to serve it alongside, naming 2-3 real recipes from this site in plain words
No heading. No bullet list. Paragraphs of 1-3 sentences.
`.trim(),

  voice: `
History is told with a wink and a real number, not as an encyclopaedia entry:
one clause of fact, one clause of comedy. Opinions are stated flatly and moved
on from. Foreign and regional names are used correctly and never explained down.
Sibling recipes are named the way you would say them out loud, mid-sentence -
lower case, inside the grammar, never as a title dropped into a slot.
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
    "Any anecdote, memory, or claim about where the author encountered the dish.",
    "Forcing a link into a sentence that does not want one.",
  ],

  examples: [
    "Tamale pies started showing up in Texas over 100 years ago, then went absolutely turnt in school cafeterias across America, which means somewhere out there is a 75-year-old still getting kinda emotional about lunch period. It's Tex-Mex comfort food royalty.",
    "Slice into it and you'll see. You get: astonishingly moist and perfect cornbread up top, gooey melty cheese in the middle, meaty seitan and bean chili holding it all down. 3 textures. 1 fork. Beautiful chaos.",
    "Risotto has a reputation for being tricky, but that's not even a little bit the story here. When arborio rice gets a steady stream of stock, it naturally releases starch and builds that silky, spoon-coating texture. Cream doesn't even get an invite. Byeeee.",
    "Serve it with some vegan chiles rellenos, calabacitas, or tofu tacos, and you just won yourself the plant-based Tex-Mex weeknight meal olympics with great ease.",
  ],

  checklist: [
    "Does every paragraph do a different job?",
    "Is there at least one sentence under 8 words?",
    "Have I named 2-3 real recipes from the list, inside normal sentences?",
    "Is every fact about the dish something I was actually given?",
    "Have I said anything about the author's life? Remove it.",
  ],
};
