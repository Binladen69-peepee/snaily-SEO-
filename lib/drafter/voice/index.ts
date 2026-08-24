/**
 * Assembling the writers a call actually needs.
 *
 * The point of splitting the voice per section is that a call pays only for the
 * sections it is writing. `briefFor(["intro"])` returns the hook writer and the
 * introduction writer and nothing about FAQs — which is both cheaper and, more
 * to the point, not an average of eleven different jobs.
 */

import { styleContext } from "@/lib/drafter/context-buckets";
import { renderDevices } from "@/lib/drafter/voice/devices";
import { HARD_CONSTRAINTS } from "@/lib/drafter/voice/constraints";
import { renderWriter, type SectionWriter, type WriterKey } from "@/lib/drafter/voice/types";
import { FAQ } from "@/lib/drafter/voice/sections/faq";
import { HOOK } from "@/lib/drafter/voice/sections/hook";
import { INGREDIENTS } from "@/lib/drafter/voice/sections/ingredients";
import { INTRO } from "@/lib/drafter/voice/sections/intro";
import { RECIPE_CARD } from "@/lib/drafter/voice/sections/recipe-card";
import { RELATED } from "@/lib/drafter/voice/sections/related";
import { SEO } from "@/lib/drafter/voice/sections/seo";
import { SERVING } from "@/lib/drafter/voice/sections/serving";
import { STEPS } from "@/lib/drafter/voice/sections/steps";
import { TIPS } from "@/lib/drafter/voice/sections/tips";
import { VARIATIONS } from "@/lib/drafter/voice/sections/variations";
import { WHY } from "@/lib/drafter/voice/sections/why";
import type { SectionKey } from "@/lib/jobs/types";

export const WRITERS: Record<WriterKey, SectionWriter> = {
  hook: HOOK,
  intro: INTRO,
  why: WHY,
  ingredients: INGREDIENTS,
  variations: VARIATIONS,
  steps: STEPS,
  serving: SERVING,
  tips: TIPS,
  faq: FAQ,
  related: RELATED,
  "recipe-card": RECIPE_CARD,
  seo: SEO,
};

/**
 * The writers a section needs.
 *
 * Only `intro` maps to more than one: the hook and the paragraphs under it are
 * written in the same call because they have to flow, and are two different
 * jobs with two different voices.
 */
export function writersFor(keys: WriterKey[]): SectionWriter[] {
  const out: SectionWriter[] = [];
  const seen = new Set<WriterKey>();

  for (const key of keys) {
    const expanded: WriterKey[] = key === "intro" ? ["hook", "intro"] : [key];
    for (const one of expanded) {
      if (seen.has(one)) continue;
      const writer = WRITERS[one];
      if (writer === undefined) continue;
      seen.add(one);
      out.push(writer);
    }
  }

  return out;
}

/**
 * The full voice brief for a call.
 *
 * Devices are filtered to the union of what those sections use, so a method
 * call is not handed a lesson in absurd escalation it is forbidden from using.
 */
export function briefFor(keys: WriterKey[]): string {
  const writers = writersFor(keys);
  if (writers.length === 0) return "";

  const devices = [...new Set(writers.flatMap((w) => w.devices))];

  return styleContext([
    HARD_CONSTRAINTS,
    renderDevices(devices),
    "## THE SECTIONS YOU ARE WRITING NOW",
    writers.map(renderWriter).join("\n\n"),
  ]);
}

/** Section keys the article body uses, for callers holding `SectionKey`s. */
export function bodyBriefFor(keys: SectionKey[]): string {
  return briefFor(keys as WriterKey[]);
}
