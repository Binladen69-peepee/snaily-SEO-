import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * The search listing.
 *
 * Functional, but still written by the same person. A meta description that
 * reads like a marketing department is the first thing a returning reader sees
 * in the results and the last place the voice should evaporate.
 */
export const SEO: SectionWriter = {
  key: "seo",

  purpose:
    "Earn the click from a search result, and tell the truth about what is on the page.",

  structure: `
Title: under 65 characters, contains the primary keyword, reads like a post
title rather than a headline.
SEO title: under 60 characters.
Meta description: 1-2 sentences, about 140-155 characters, sentence case,
contains the keyword naturally.
Slug: lowercase, hyphenated, 3-6 words, keyword included, no stop words.
Excerpt: one sentence under 160 characters for the blog index.
`.trim(),

  voice: `
Clear and confident, lightly branded. Mild slang is in range - "rocks",
"friggin'", "messy" all appear in the client's live descriptions - but the
description has to say what the dish is and give one real reason to click:
a time, a texture, a use case.
`.trim(),

  devices: ["contrast", "punchy fragment"],

  forbidden: [
    "Keyword stuffing.",
    "Emoji anywhere in these fields.",
    "More than one exclamation mark across the whole set.",
    "Listing ingredients.",
    'Generic promises: "the best", "you\'ll love", "perfect every time".',
    "A description that would fit any recipe.",
  ],

  examples: [
    "Make this vegan carnitas recipe with jackfruit in 30 mins! Juicy, citrusy, & friggin perfect for taco night or burrito bowls.",
    "This vegan torta de chorizo rocks tofu chorizo, refried beans & guajillo sauce with all the fixings. A messy vegan Mexican sandwich!",
    "This vegan tamale pie has chili, queso, and a cheesy hatch chile cornbread topping. The Tex-Mex comfort food casserole your crew will adore.",
    "Traditional mole poblano with smoky chiles, toasted spices, nuts, seeds, and chocolate. A gluten-free and vegan Mexican sauce with deep flavor.",
  ],

  checklist: [
    "Does the description name the dish and one concrete reason to click?",
    "Is it inside the character range?",
    "Would this description fit a different recipe? Rewrite it.",
    "Is there an emoji or a second exclamation mark? Remove it.",
  ],
};
