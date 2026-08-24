import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * The first paragraph, above the first photo.
 *
 * Measured against the corpus, this is where the client's voice is densest and
 * where the Drafter's was thinnest: the generated hook averaged 22-word
 * sentences with no fragment and no aside, against a corpus that opens with a
 * stranger doing something ridiculous and lands on a three-word sentence.
 */
export const HOOK: SectionWriter = {
  key: "hook",

  purpose:
    "Stop someone mid-scroll, tell them exactly what the dish is, and make the next scroll feel worth it. It sits alone above the first image and carries no heading.",

  structure: `
3-4 sentences. Occasionally 2 when the dish is simple.
Sentence 1 opens one of three ways, whichever suits the dish:
  - a person or scene doing something absurd that led to this food
  - "This vegan [dish] is …" straight in
  - a question naming the reader's real problem, answered in sentence 2
The dish name and the word vegan appear in the first two sentences.
The last sentence is short. Often a fragment. It is the payoff.
No formatting, no bold, no links, no headings.
`.trim(),

  voice: `
Sentences vary hard: a long one that runs on a bit, then four words. Write at
about 15 words a sentence on average and let a quarter of them come in under 8.
One concrete image built from named things, never from three adjectives.
Contractions throughout. "You" early. First person is fine and common.
`.trim(),

  devices: [
    "unexpected analogy",
    "absurd escalation",
    "punchy fragment",
    "unusual visual image",
    "playful exaggeration",
  ],

  forbidden: [
    'Opening with the season, the weather, or "As the leaves turn".',
    'Opening with "When it comes to", "Whether you\'re a", "Picture this", "Look no further".',
    "Naming another recipe or linking anything. The hook stands alone.",
    'Generic adjectives doing the work: cozy, delicious, silky, velvety, hearty, comforting, "warm hug", "cozy bowl", "feel good about the planet", "brightens the plate".',
    "Comfort-food filler metaphors of any kind. Name a thing instead.",
    "Any claim about testing, popularity, or the author's history.",
  ],

  examples: [
    "Some freak once gave tamales the side eye, and said \"what if we made this a casserole\" and that person changed the entire trajectory of comfort food history. This vegan tamale pie is basically really good chili and vegan queso with a fluffy AF golden cornbread top. It's a mega-low-effort quick-win for potlucks and meal-prep alike.",
    "This autumnal vegan butternut squash mac and cheese is everything your comfort food-loving heart or Thanksgiving table could possibly want. It's velvety from cashews, rich with golden butternut squash, and totally throws processed store-bought cheeze off the Empire State Building observation deck to its perilous fate below. You'll be dunking your spoon into the empty pot in under 30 minutes.",
    "A complete Sunday dinner that doesn't take all day to make? This vegan shepherd's pie recipe delivers can't-stop-eating-it vibes with layers of red wine-kissed tofu-beef filling and garlicky mashed potatoes. It's built from everyday ingredients, doesn't leave you with a sink full of dishes, and it's Thanksgiving table-ready in about an hour.",
  ],

  checklist: [
    "Is the last sentence shorter than the first?",
    "Is there exactly one concrete image, made of named things?",
    "Have I said what the dish actually is, in plain words?",
    "Would this sentence fit any other recipe? If yes, rewrite it.",
    "Have I invented anything about the author? Remove it.",
  ],
};
