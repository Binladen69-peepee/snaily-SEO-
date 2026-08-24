import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * "Why you'll adore this …" — the scannable sell.
 *
 * The format is documented and rigid; the writing inside it is not. Two of the
 * lines are fixed by the client's own template and the rest are where the
 * recipe gets to be specific about itself.
 */
export const WHY: SectionWriter = {
  key: "why",

  purpose:
    "Four or five reasons to make this one rather than another, written to be skimmed. The two fixed lines carry the site's promises; the rest carry this recipe's.",

  structure: `
H2: "🥰 Why you'll adore this [dish]" - or "…these [dish]" for a plural.
Then 3-5 entries, each its own PARAGRAPH. Never a bullet, dash or number.
Each entry: a unique emoji, then **Bold Heading:** then one or two sentences.

Two entries are fixed by the site's format:
  ✊ **Vegan AF:** what is NOT in it that the usual version has. Names a group
     of this site's recipes in plain words - "like all of my vegan Tex-Mex
     recipes". Add "and GF" only when the recipe genuinely is.
  ✅ **Tested and Approved Worldwide:** always the last entry. Mentions recipe
     testers, in the site's existing wording, and nothing more specific.

Between them, 2-3 entries about what is actually unusual here.
`.trim(),

  voice: `
Headings are claims with a personality, not labels: "There Is a Whole Queso
Layer In This Thing", not "Delicious Filling". Explanations are one punchy
sentence with a real detail in it. At most one entry is funny; the others are
simply useful. Bold headings use Title Case.
`.trim(),

  devices: ["direct dismissal", "playful exaggeration", "contrast", "punchy fragment"],

  forbidden: [
    "Writing the entries as a bulleted or numbered list.",
    "Any testing claim beyond the site's existing wording - no counts, no countries, no names, no 'from Berlin to Portland'.",
    "Health or nutrition claims of any kind.",
    "A heading that would fit any recipe: Easy, Delicious, Quick, Family Favourite.",
    "Reusing an emoji within the section.",
  ],

  examples: [
    "🧀 **There Is a Whole Queso Layer In This Thing:** Not messing around with some measly shreds of Daiya sprinkled on top like a Godforsaken afterthought. Yep. There's an entire layer of vegan queso between the chili and the cornbread. You will be sincerely psyched.",
    "✊ **Vegan AF (and Eeeasily GF):** Not a single animal's been harmed (though several HAVE been snuggled) in the making of any of my vegan Tex-Mex recipes. Swap the flour in the cornbread topping for your fave gluten-free option, use a GF chili, and you can even love this if you hate gluten with all of your heart and soul.",
    "🍽️ **1 Pan. That's It. 1:** Everything bakes in a single 9 x 13-inch (23 x 33 cm) dish. I've made recipes that required 7 separate pots and I am forever sorry about that. This is not one of those recipes.",
    "✅ **Tested and Approved Worldwide:** Every vegan recipe I share survives a full global taste test from a global team of recipe testers before it gets posted. Think of it as a very delicious job interview, and this one got the job.",
  ],

  checklist: [
    "Is every entry a paragraph, with no bullet marker in front of it?",
    "Is the Vegan AF entry present, and does it name a group of this site's recipes?",
    "Is Tested and Approved Worldwide the last entry, in the site's own wording?",
    "Does each heading say something only this recipe could say?",
    "Have I claimed a tester count or location I was not given? Remove it.",
  ],
};
