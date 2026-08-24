import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * Recipe FAQs.
 *
 * The section most likely to invent a fact, because a question invites an
 * answer and a model would rather answer than decline. Every answer here has
 * to come out of the recipe.
 */
export const FAQ: SectionWriter = {
  key: "faq",

  purpose:
    "Answer what someone genuinely hesitates over before cooking, so they stop hesitating. Storage is almost always one of them.",

  structure: `
H2 exactly "🤷‍♀️ Recipe FAQs".
3-5 questions. Each is a real question someone would type, phrased as a
question, ending in a question mark.
Answers are 1-3 sentences: the answer first, then the nuance that makes it
useful.
The storage question is usually last and usually longest, broken into
emoji-labelled lines - refrigerating, freezing, thawing, reheating - with real
time ranges from the recipe or ordinary safe practice.
At most one internal recipe named in the whole section, and only where it
genuinely helps.
`.trim(),

  voice: `
Reassuring and slightly amused. The reader is never made to feel stupid for
asking. Gentle teasing is in range once. Practical answers stay practical -
humour never gets between the reader and the number of days.
`.trim(),

  devices: ["self-aware comment", "direct dismissal", "weird personal aside"],

  forbidden: [
    "Any ingredient, substitution, time or temperature that is not in this recipe.",
    "Turning a cooking instruction into a question.",
    "A question the recipe cannot answer. Ask a different one.",
    "Inventing what readers have asked, or what happened when someone tried it.",
    "Health, nutrition or dietary-benefit claims.",
  ],

  examples: [
    "Can I make this ahead? Yes. Cool it, cover it, refrigerate up to 4 days. Reheat gently on the stove with a splash of the cooking liquid already in the recipe - not with an ingredient you were not given.",
    "Is this vegan tamale pie gluten free? It can be. Swap the all-purpose flour for a gluten-free all-purpose blend and you're set. Just double-check that your chili is also certified gluten free if that matters for your situation.",
    "How should I store and reheat vegan torta de chorizo? Come on, you've made a sandwich before in life right? For best results, store the components separately and assemble fresh next time. This keeps the bread from getting soggy and makes reheating way less annoying.",
    "Why does my mole poblano taste bitter? Because, my silly goose-guy, the chiles or spices probably got toasted a little too hard. Pull them as soon as they smell fragrant and never let them go dark or acrid.",
  ],

  checklist: [
    "Is every question actually a question?",
    "Could I point at the recipe for every fact in every answer?",
    "Have I mentioned an ingredient this recipe does not contain? Remove it.",
    "Is there a storage answer with real time ranges?",
    "Have I invented anything about readers or testers? Remove it.",
  ],
};
