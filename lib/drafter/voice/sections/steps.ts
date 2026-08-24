import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * The method.
 *
 * The one section where the personality is confined to a single line and the
 * rest has to be boringly correct. Someone is reading this with wet hands.
 */
export const STEPS: SectionWriter = {
  key: "steps",

  purpose:
    "Walk through the recipe accurately. The pun carries the fun so the instruction does not have to; the instruction carries the numbers so nobody has to guess.",

  structure: `
Open with one casual, self-aware paragraph: the reader is hungry, nobody needs
47 overhead shots, the printable card is below.
H2 carrying 📖: "📖 How to make [dish]" or a keyword variation.
Then every step in exactly this three-part shape:

### Step One

**Chili Me Softly:**

Preheat your oven to 375°F (190°C). Lightly grease a 9 x 13-inch (23 x 33 cm) baking dish.

The ### heading is the written number and nothing else.
The pun is its own bold paragraph, ending in a colon, never a dash.
The instruction follows as plain prose: 1-3 imperative sentences.
Cover every step from the recipe, in order, and invent none.
`.trim(),

  voice: `
The pun is where all the personality goes: a film, a song, a band or a
character bent around the cooking word for that step. Vary the trick between
steps and never repeat a formula in one post.
The instruction is flat and exact. Imperative verbs, the real temperatures and
times, a doneness cue only when the recipe itself gives one - "until fragrant"
is fine when the paste says it. No jokes, no asides, no explaining why, no
invented sensory narration.
1-3 sentences. A one-minute flour step is one or two sentences. Do not pad.
`.trim(),

  devices: ["pop-culture reference", "self-aware comment"],

  forbidden: [
    "Putting the pun in the ### heading, or ending it with a dash.",
    "Personality inside the instruction. Clarity beats charm here every time.",
    '"pause briefly to admire", "the aroma will shift", "the foundation is set", or any other invented sensory filler.',
    "A temperature, time or quantity that is not in the recipe.",
    "Merging two recipe steps, reordering them, or adding one.",
    'Vague doneness: "cook until done", "cook for a while".',
    "The same pun formula twice in one post.",
  ],

  examples: [
    "You can practically smell that cornbread already and it doesn't even exist yet. That's the power of tamale pie, m'love. Follow these step-by-step instructions for the full breakdown, or skip to the printable easy recipe card below before your imagination tortures you any further.",
    "**In Queso Emergency:** Spoon the queso over the chili, then spread it into an even single layer using the back of a spoon or an offset spatula.",
    "**Corn on the Fourth of July:** In a large bowl, whisk together the cornmeal, masa harina, flour, baking powder, baking soda, salt, and egg replacer powder. Create a well in the center.",
    "**Bake Me Out to the Ball Game:** Bake for 35 to 40 minutes, until the topping is golden and a toothpick inserted into the center comes out clean. Brush with vegan butter immediately after removing the casserole from the hot oven.",
  ],

  checklist: [
    "Is every ### heading only the written step number?",
    "Does every pun sit in its own bold paragraph and end in a colon?",
    "Does every number in the instructions match the recipe exactly?",
    "Are the steps in the recipe's order, all of them, with none added?",
    "Have I used the same kind of pun twice? Change one.",
  ],
};
