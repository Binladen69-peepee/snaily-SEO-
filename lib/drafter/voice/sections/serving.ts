import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * Serving ideas — the most link-dense section on the page.
 *
 * The reader has decided to cook it and is now building a table around it.
 */
export const SERVING: SectionWriter = {
  key: "serving",

  purpose:
    "Turn one dish into a meal, and give the reader somewhere else on this site to go while they are still excited.",

  structure: `
H2 carrying 💡, e.g. "💡Serving Ideas".
2-4 paragraphs, each a different angle:
  - the pairing that is not optional
  - the rest of the meal
  - something for a guest who wants otherwise
  - dessert, when the cuisine has one worth naming
Name 8 or more real recipes from the list across the section, grouped so each
paragraph stays on one idea.
`.trim(),

  voice: `
An enthusiastic host, mid-plan. Casual connectors carry the paragraphs:
"Otherwise, this partners up naturally with…", "It's also killer to serve
with…", "Just want more meaty stuff to rock with this?".
Say why a pairing works when it is not obvious - cutting richness, crunch
against something soft. Recipe names sit inside the grammar of the sentence, in
the case you would say them in, never dropped in as titles.
`.trim(),

  devices: [
    "playful exaggeration",
    "unusual visual image",
    "direct dismissal",
    "punchy fragment",
  ],

  forbidden: [
    'Vague pairings: "serve with a salad", "great with rice".',
    "Naming a recipe that is not on the list you were given.",
    "Repeating the method or the ingredients.",
    "A non-vegan pairing, in any form.",
    "Title Case anchors. Write the recipe name as prose.",
    "An ingredient, wine, coconut milk, or substitution that is not in RECIPE_CONTEXT.",
  ],

  examples: [
    "This bò kho chay needs vegan bánh mì or any Vietnamese baguette, no discussion. The crusty baguette goes in, comes out drenched, and suddenly everyone is suspiciously quiet, except for the sound of eyes rolling back in heads.",
    "Otherwise, this partners up naturally with other Vietnamese dishes like lemongrass tofu, ca ri chay, bánh tráng trộn, mi xào xì dầu, or a big bowl of Vietnamese sticky rice as a complete and absurdly tasty meal.",
    "Serve it with some vegan chiles rellenos, calabacitas, or tofu tacos, and you just won yourself the plant-based Tex-Mex weeknight meal olympics with great ease. Like a wild tamale-eating sports goose.",
    "For dessert, rock some bánh flan, chè ba màu, kem chuối, banh da lon, or chè khoai môn. All vegan, all mad lovely.",
  ],

  checklist: [
    "Does each paragraph cover a different angle?",
    "Have I named 8 or more recipes, all from the list?",
    "Is every recipe name written the way I would say it in a sentence?",
    "Have I explained why at least one pairing works?",
    "Is there a vague suggestion anywhere? Make it specific or cut it.",
  ],
};
