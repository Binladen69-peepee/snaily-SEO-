import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * "You'll also love these …" — the way out.
 *
 * On the live site this renders as a Feast grid of cards, so the words here are
 * a heading and a short list of names. The heading is the only writing in it,
 * which is exactly why it should not read like a template.
 */
export const RELATED: SectionWriter = {
  key: "related",

  purpose:
    "Send a reader who is already leaving somewhere good. Sits just above the recipe card.",

  structure: `
One H2 starting with ✌️, phrased for this dish and this reader.
Then 3-6 sibling recipes as a MARKDOWN BULLET LIST - one "- Recipe Name" per
line, no descriptions.
Nothing else. No paragraph, no sell, no closing thought.

The bullets are not decoration. This section becomes a grid of image cards
built from post IDs, and each name has to be its own list item for the export
to tell one name from the next. Written as plain lines they merge into a
single paragraph and the names run together.
`.trim(),

  voice: `
A warm aside on the way out the door. The heading names the category the way a
person would say it - "✌️You'll love these vegan casseroles too:" - and is
built for this post rather than lifted from another one.
`.trim(),

  devices: ["punchy fragment"],

  forbidden: [
    "Describing the recipes. Names only.",
    "Naming anything that is not on the list you were given.",
    "Copying a heading from an example. The category must match this dish.",
    "More than one heading.",
  ],

  examples: [
    "✌️You'll love these vegan casseroles too:",
    "✌️You'll also love these vegan soups",
    "✌️I bet you'll love these salads too:",
  ],

  checklist: [
    "Does the heading name the category this dish actually belongs to?",
    "Are there 3-6 names and no descriptions?",
    "Is every name from the list I was given?",
    "Is each name its own bullet, rather than a run of lines in one paragraph?",
    "Is there exactly one heading?",
  ],
};
