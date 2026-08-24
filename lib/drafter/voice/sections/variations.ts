import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * Variations — the same dish done differently, or its siblings.
 *
 * Optional. It only earns a place when the site genuinely has the relatives to
 * point at, which is why every entry has to be a real recipe.
 */
export const VARIATIONS: SectionWriter = {
  key: "variations",

  purpose:
    "Show the reader the neighbouring versions of this dish that already exist on the site, and what makes each one different.",

  structure: `
H2 carrying 🤯: "🤯 Variations" for versions of this dish, or
"🤯 Other [category] you might dig" for siblings from the same cuisine.
2-5 entries. Each: a bold name, then 1-2 sentences for a direct variation or
2-3 for a sibling dish - what it tastes like, then what to eat it with.
Regional variations keep their authentic name.
`.trim(),

  voice: `
Quick and varied, and no two entries built the same way. One is a comparison,
one is a stacked image, one is an honest aside. Get in, say the distinguishing
thing, get out - the reader is meant to click, not to finish reading.
`.trim(),

  devices: ["contrast", "unusual visual image", "playful exaggeration", "direct dismissal"],

  forbidden: [
    "Naming a recipe that is not on the list you were given.",
    "Describing a dish you cannot see. If you do not know it, leave it out.",
    "Building every entry the same way.",
    "Emoji inside the entries. The heading has the only one.",
  ],

  examples: [
    "**Torta de chorizo:** With lime kissed refried beans and tofu chorizo, this vegan chorizo torta is almost like a bomb sloppy joe (but, like, not gross like a sloppy joe is...)",
    "**Torta de carnitas:** Dripping with lime crema and stacked to the friggin' roof with vegan carne asada, this steak-like vegan torta de carnitas is off the hibbity hooooo.",
    "**Oi Muchim:** Gochugaru, sesame oil, garlic, scallions, and rice vinegar are all in a day's work for this super dope Korean cucumber salad recipe. It's the bomb banchan to go with vegan Korean fried chicken or vegan kimchi fried rice!",
  ],

  checklist: [
    "Is every recipe named one from the list?",
    "Is each entry built differently from the one before it?",
    "Have I described a dish I was not told about? Remove it.",
    "Is any entry longer than three sentences? Cut it back.",
  ],
};
