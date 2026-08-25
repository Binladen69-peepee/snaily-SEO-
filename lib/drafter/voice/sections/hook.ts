import type { SectionWriter } from "@/lib/drafter/voice/types";

/**
 * The first paragraph, above the first photo.
 *
 * Built from the Cinnamon Snail writing style guide, the blog-writing
 * training document, and the published Vegan Tamale Pie post as the gold
 * standard. The training names three opening patterns. Tamale Pie adds a
 * fourth — an origin scene — that is only legal when RESEARCH_CONTEXT
 * actually contains that origin. Inventing a freak, a cafeteria, or a
 * makeover is how stroganoff stopped sounding like this author.
 */
export const HOOK: SectionWriter = {
  key: "hook",

  purpose:
    "Stop someone mid-scroll, say what the dish is, and make the next scroll feel worth it. It sits alone above the first image and carries no heading.",

  structure: `
3-4 sentences. Occasionally 2 when the dish is simple. Rarely 5.
Flow: what it is → named components or one sensory/benefit detail → a short payoff.
The dish name and the word vegan appear in the first two sentences.
The last sentence is short. Often a fragment. Time, occasion, or a punch.

Open with ONE of these, chosen from what you actually know:

1. Direct: "This vegan [dish] is…" then named parts, not adjectives.
   Default for familiar comfort food (stroganoff, chili, pasta, casseroles).
2. Question: a real problem in sentence 1, the dish answering it in sentence 2.
3. Name-first: lead with the dish name (and authentic name in parentheses
   for less-familiar dishes).
4. Origin scene: a person or moment that led to this food. ONLY if
   RESEARCH_CONTEXT already contains that origin. If it does not, use 1.

No formatting, no bold, no links, no headings.
`.trim(),

  voice: `
Talking to a friend over coffee. Contractions. "You" early. First person is
fine. Parenthetical asides are in range: a mutter, not a speech.
Sentences vary hard: a long one, then four words. About 15 words a sentence
on average, a quarter of them under 8.
One concrete image built from named things (chili, queso, cornbread), never
from three adjectives (creamy, cozy, comforting).
Hyphenate compound descriptors before a noun: "fluffy AF golden cornbread top",
"mega-low-effort quick-win". Connect clauses with a plain hyphen, never an
em dash. Parentheses for an interruption.
Casual slang from the house list at most once in the hook (AF, friggin', hella).
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
    "Inventing an origin, a person, a city, a cafeteria, a makeover, or a history the research does not contain.",
    "Naming another recipe or linking anything. The hook stands alone.",
    "Recipe instructions, temperatures, or timings.",
    'Generic adjectives doing the work: cozy, delicious, amazing, silky, velvety, hearty, comforting, "warm hug", "cozy bowl", "feel good about the planet", "brightens the plate".',
    "Comfort-food filler metaphors of any kind. Name a thing instead.",
    "Health claims of any kind.",
    "Any claim about testing, popularity, or the author's history.",
    "Marketing copy. Banned-list words (mouthwatering, elevate, game changer, hits all the right notes).",
  ],

  examples: [
    'Some freak once gave tamales the side eye, and said "what if we made this a casserole" and that person changed the entire trajectory of comfort food history. This vegan tamale pie is basically really good chili and vegan queso with a fluffy AF golden cornbread top. It\'s a mega-low-effort quick-win for potlucks and meal-prep alike.',
    "This vegan bò kho chay is the deeply spiced Vietnamese stew that'll make your kitchen smell friggin' insane without having to simmer a boneless beef shank stock in a slow cooker for hours on end. Hyper-rich brick-red broth, with plenty of fresh lemon grass stalks to go around, and hoisin glazed lion's mane mushrooms emulating the beef noodle soup vibes without a single cow being harmed.",
    "A complete Sunday dinner that doesn't take all day to make? This vegan shepherd's pie recipe delivers can't-stop-eating-it vibes with layers of red wine-kissed tofu-beef filling and garlicky mashed potatoes. It's built from everyday ingredients, doesn't leave you with a sink full of dishes, and it's Thanksgiving table-ready in about an hour.",
    "This vegan Vietnamese fried chicken comes packing some crackly yuba skin, juicy star anise-simmered seitan inside, and (of course) gets served with the typical Vietnamese fragrant red rice. But then it gets coated with sweet, sour, and spicy (and 300% fish-free) nước chấm and topped with chili slices and hella herbs. I mean, come on already!",
  ],

  checklist: [
    "Is the dish name and the word vegan in the first two sentences?",
    "Is the last sentence shorter than the first?",
    "Did I name what is IN the dish, not a mood?",
    "If I wrote an origin story, is that origin in RESEARCH_CONTEXT? If not, rewrite as Direct.",
    "Would this sentence fit any other recipe? If yes, rewrite it.",
    "Have I invented anything about the author? Remove it.",
    "Would I scroll? If not, rewrite it.",
  ],
};
