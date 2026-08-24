/**
 * Recurring Cinnamon Snail post structure, derived from recent published
 * Gutenberg posts (zucchini muffins, mücver, bazlama, manakeesh, fattoush,
 * yalanji, beet hummus).
 *
 * Every post opens with a hook paragraph (no heading), a lead image, more
 * intro, then emoji H2s: Why you'll adore → Ingredients → optional Variations
 * → How to make (H3 steps) → Serving → Tips → FAQ → WP Recipe Maker card.
 */

export const CS_POST_SECTIONS = [
  {
    id: "hook",
    label: "Hook",
    required: true,
    heading: null as string | null,
    note: "3–4 sentences, no heading, above the lead photo.",
  },
  {
    id: "lead-image",
    label: "Lead image",
    required: true,
    heading: null,
    note: "Full-width photo, same treatment as published posts.",
  },
  {
    id: "intro",
    label: "Rest of the intro",
    required: true,
    heading: null,
    note: "Story, origin, why this version — still no heading.",
  },
  {
    id: "adore",
    label: "Why you'll adore",
    required: true,
    heading: "Why you'll adore this",
    note: "H2 with 🥰. Bullets, Vegan AF first-ish, testers last.",
  },
  {
    id: "ingredients",
    label: "Specialty ingredients",
    required: true,
    heading: "Ingredients",
    note: "H2 with an emoji. H3 per unusual ingredient only.",
  },
  {
    id: "variations",
    label: "Variations",
    required: false,
    heading: "Variations",
    note: "H2 often 🤯. Skip when the recipe has no real variants.",
  },
  {
    id: "method",
    label: "How to make",
    required: true,
    heading: "How to make",
    note: "H2 with 📖. Punny H3s, then clear steps from the pasted recipe.",
  },
  {
    id: "serving",
    label: "Serving ideas",
    required: true,
    heading: "Serving ideas",
    note: "H2 with 💡. Plate, pairings, leftovers.",
  },
  {
    id: "tips",
    label: "Top tips",
    required: false,
    heading: "Top tips",
    note: "H2 with 👉. Pitfalls only.",
  },
  {
    id: "faq",
    label: "FAQ",
    required: true,
    heading: "FAQ",
    note: "H2 with 🤷‍♀️. 3–5 real questions.",
  },
  {
    id: "recipe",
    label: "Recipe card",
    required: true,
    heading: "Recipe",
    note: "H2. Ingredients and method from the paste — WP Recipe Maker on the site.",
  },
] as const;

export type CsSectionId = (typeof CS_POST_SECTIONS)[number]["id"];
