/**
 * The section playbook, split by section.
 *
 * `SECTION_PLAYBOOK` describes all eleven sections in one block. That was fine
 * when one call wrote the whole post; it is waste once the post is written in
 * five bounded calls, because the call writing Top tips was still paying about
 * 1,400 tokens to read the rules for the recipe card. Same rules, addressed
 * individually — nothing here is new guidance, it is the same document indexed
 * by the section it applies to.
 */

import { bodyBriefFor } from "@/lib/drafter/voice";
import type { SectionKey } from "@/lib/jobs/types";

export const SECTION_RULES: Record<SectionKey, string> = {
  intro: `
HOOK + INTRO (no headings at all in this section).
Hook: first paragraph, 3-4 sentences. Flow: what it is → sensory or benefit →
time promise, ethical note, or punchy payoff. Mention vegan and the dish in the
first 1-2 sentences. Specific sensory words, never "delicious". No formatting.
No recipe names in the hook — it sits above the first photo on its own.
Then 2-4 more short paragraphs: history or origin with a wink, what the dish
actually is, what makes THIS version worth making, how the vegan swap works
without a lecture. Do not repeat the hook. Do not start giving instructions.
Across those paragraphs — never in the hook — name 2 or 3 real recipes from
this site in plain words, inside a serving idea or a comparison, the way you
would mention them to a friend. Never force one in.
`.trim(),

  why: `
WHY YOU'LL ADORE — H2 "🥰 Why you'll adore this [dish]" (or "…these [dish]" for
plurals).
3-5 entries, each its own PARAGRAPH — never a bullet, never a dash, never a
number. Each paragraph: a unique emoji + **Bold heading:** + one punchy
sentence.
First paragraph is **Vegan AF** — what is NOT in it that the traditional
version uses. Last paragraph is **Tested and Approved Worldwide** — use the
site's existing wording only. No tester counts, no cities, no countries, no
"home cooks from X to Y".
Both of those name a group of the site's recipes in plain words, the way the
site does it: "like all of my vegan Thai recipes", "like all of the vegan
recipes on my blog". Name a real one from SITE_CONTEXT, never from STYLE_CONTEXT.
2-3 more paragraphs on what is genuinely special about THIS recipe, at least
one with personality. No health claims.
`.trim(),

  ingredients: `
SPECIALTY INGREDIENTS — this is NOT a copy of the ingredient list. It explains
only the handful of items a reader might not have bought before. You will be
given the exact list to cover; write about those and no others, and never
restate the full recipe.
H2 may be punny or "Ingredients for [dish]" and takes a dish-specific emoji.
One sub-block per given item: the item name as a bold mini-heading, then 2-4
sentences — what it is, why it is here, what substitutes for it, and a warning
about lookalikes where one exists (young green jackfruit vs ripe yellow).
Where another recipe on this site uses the same item, name that recipe in plain
words inside the sub-block — that is how the site cross-references.
`.trim(),

  variations: `
VARIATIONS — H2 carries 🤯: "🤯 Variations" for versions of this dish, or
"🤯 Other [category] you might dig" for siblings from the same cuisine.
2-5 entries. Each: **Bold variation name**, then 1-2 sentences for a direct
variation and 2-3 for a sibling dish (flavour profile, then a pairing).
Vary the sentence shape between entries. Regional variations keep their
authentic name and get one line on what makes them different.
Never invent a recipe that does not exist. No emoji inside the entries.
`.trim(),

  steps: `
STEP-BY-STEP — open with one casual, self-aware paragraph: hungry reader, no 47
overhead shots, scroll to the recipe card for the print version.
H2 carries 📖: "📖 How to make [dish]" or a keyword variation, not a repeat of
the title.
Then every step is written in exactly this three-part shape and no other:

### Step One

**Sauté Night Fever:**

Heat the oil in a wide pan over medium heat and cook the onion for 6 minutes.

The ### heading is the step's written number and nothing else — "Step One",
"Step Two", "Step Three". Never put the pun in the heading.
The pun is its own bold paragraph on the next line and ends in a colon, never
a dash.
The instruction follows underneath as ordinary unbolded prose: 1-3 imperative
sentences carrying the real temperatures and times from RECIPE_CONTEXT.
A one-minute step stays one or two sentences. Do not pad with aroma, admiration,
or "the foundation is set".
Every step gets a pun — 80s/90s pop-culture wordplay that swaps part of a
known phrase for a cooking word ("Pour-ever Young", "Blend It Like Beckham",
"I'll be Bake", "Cornbreaddy Krueger"). Vary the technique between steps and
never reuse a formula twice in one post.
Personality lives in the pun, not in the instruction.
Cover every step from RECIPE_CONTEXT, in order, and invent none.
`.trim(),

  serving: `
SERVING SUGGESTIONS — H2 carries 💡, e.g. "💡Serving Ideas".
2-4 paragraphs, each a different angle: the essential pairing, the rest of the
meal, variations for guests, then dessert.
This is the most recipe-naming section of the post — name 10 or more sibling
recipes across it, grouped by course or cuisine, never a bare "serve with a
salad". Say why a pairing works when it is not obvious (texture contrast,
cutting richness). Do not repeat the method.
`.trim(),

  tips: `
TOP TIPS — H2 exactly "👉Top tips". Never "Tips" or "Pro tips".
3-5 tips. Each is its own paragraph: an imperative Title Case directive ending
in a colon, then 1-3 sentences of explanation.
Each tip covers ONE risk, technique or fix — what quietly ruins the dish if you
do not know better. Corrective and experience-based, never a restatement of a
step, and no measurements or temperatures. At least one carries real humour.
No bullet symbols and no numbering.
`.trim(),

  faq: `
RECIPE FAQS — H2 exactly "🤷‍♀️ Recipe FAQs".
3-5 questions a real reader would ask: substitutions, spice level, make-ahead,
storage and reheating, equipment. Conversational answers, 1-3 sentences each.
Every question must read as a question someone would type into Google; never
turn a cooking instruction into one.
Where a substitution or a pairing is genuinely another recipe on this site,
name it in plain words — but at most once in the whole section.
Answer only from RECIPE_CONTEXT. Never import an ingredient, a method or a
timing from STYLE_CONTEXT. If the recipe has no coconut milk, the FAQ does not
mention coconut milk. If it has no wine, there is none.
`.trim(),

  related: `
YOU'LL ALSO LOVE — a closing list of sibling recipes. Write ONE heading and one
short list, nothing else.
H2 starts with ✌️ and is a warm aside phrased for THIS dish. Past posts have
used shapes like "…these vegan muffin recipes:" and "…I bet you'll love these
salads too:" - those are shapes to borrow, not text to copy, and the category
must match the recipe being written.
Then 3-6 sibling recipes by name, one line each, no descriptions.
Only name recipes from the list of the site's real published posts.
`.trim(),
};

/**
 * Rules for exactly the sections a call is writing.
 *
 * The terse structural rules above, then the full writer brief from
 * `lib/drafter/voice` - purpose, voice, devices, real examples and a checklist,
 * per section. Both are per-section, so the cost scales with what is being
 * written rather than with how many sections the format has.
 */
export function rulesFor(keys: SectionKey[]): string {
  const structure = keys.map((k) => SECTION_RULES[k]).join("\n\n");
  const brief = bodyBriefFor(keys);
  return brief === "" ? structure : `${structure}\n\n${brief}`;
}
