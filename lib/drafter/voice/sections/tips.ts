import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * Top tips — what quietly ruins the dish.
 *
 * Corrective, not instructional. If it repeats a step it does not belong here.
 */
export const TIPS: SectionWriter = {
  key: "tips",

  purpose:
    "Save the reader from the specific ways this dish goes wrong, in the voice of someone who has done it.",

  structure: `
H2 exactly "👉Top tips". Never "Tips" or "Pro tips".
3-5 tips, each its own paragraph. No bullets, no numbers.
Each: an imperative Title Case directive ending in a colon, then 1-3 sentences
that name the failure, say what causes it, and give the stopping point.
`.trim(),

  voice: `
Firm and a bit chaotic. Say what the failure looks and feels like rather than
calling it important - gluey, gummy, sunken, dense. One or two tips carry real
humour; appliances are allowed opinions. Second person throughout.
`.trim(),

  devices: [
    "unexpected analogy",
    "playful exaggeration",
    "direct dismissal",
    "self-aware comment",
  ],

  forbidden: [
    "Restating a step from the method.",
    "Any temperature or measurement. Those live in the recipe.",
    'Vague reassurance: "this helps a lot with flavor".',
    "Bullet symbols or numbering.",
    "A tip that would apply to any recipe.",
  ],

  examples: [
    "**Don't Overmix the Batter:** Stir just until no dry clumps remain and then put the spatula down. Mixing too much develops the gluten and turns your fluffy cornbread topping into something you could use to patch drywall.",
    "**Your Chili Needs to Be Thick:** If it's thin and soupy, the cornbread batter will sink right into it and bake up dense and gummy on the bottom. If you are working with something mega-loose like vegan taco soup, drain it almost entirely first.",
    "**Rotate your tray:** Ovens love to act shady and play favorites with which side gets more heat, so give your baking sheet a halfway spin.",
    "**Cook the Tomatoes Till They Collapse:** Do not rush this, babe. Let those ripe tomatoes fully break down so the broth gets that gentle red color and doesn't have mealy chunks of barely cooked tomato in it.",
  ],

  checklist: [
    "Does each tip name one specific failure of this dish?",
    "Have I repeated anything the method already says? Cut it.",
    "Is there a measurement anywhere in here? Remove it.",
    "Does at least one tip actually make me smile?",
    "Are these paragraphs, with no bullet markers?",
  ],
};
