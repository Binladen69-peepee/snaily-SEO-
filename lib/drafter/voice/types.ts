/**
 * What a section writer is.
 *
 * The Drafter used to hold one description of "the house style" and send it to
 * every call. That produces the average of eleven sections, and the average of
 * a hook, a method step and an FAQ answer is a competent stranger — which is
 * exactly the complaint.
 *
 * So each section gets its own writer: what it is for, what shape it must take,
 * how it sounds, which devices are in range, what it must never do, real
 * examples from the client's own published posts, and a checklist the model can
 * hold itself to before it answers. A call assembles only the writers for the
 * sections it is writing.
 */

import type { SectionKey } from "@/lib/jobs/types";

/**
 * Sections that get their own writer.
 *
 * "hook" is not a SectionKey: the hook and the rest of the introduction are
 * one section in the document and two entirely different jobs on the page, so
 * they get a writer each and are assembled into the same call.
 */
export type WriterKey = SectionKey | "hook" | "recipe-card" | "seo";

export type SectionWriter = {
  key: WriterKey;
  /** Why this section exists on the page, in one or two lines. */
  purpose: string;
  /** The shape it must come back in. Counts, headings, ordering. */
  structure: string;
  /** How this section sounds, as distinct from the rest of the post. */
  voice: string;
  /** Devices from `devices.ts` that suit this section. Names, not prose. */
  devices: string[];
  /** Patterns that are wrong here specifically, beyond the global bans. */
  forbidden: string[];
  /**
   * Verbatim excerpts from the client's published posts.
   *
   * Copied from the site, never paraphrased. They are shown as evidence of the
   * shape, and every prompt that uses them says plainly that the words are not
   * to be reused — a model handed an example will otherwise lift a phrase from
   * it, and "unpaid tamale elf" appearing on two posts is worse than a flat
   * sentence.
   */
  examples: string[];
  /** What the model checks before answering. */
  checklist: string[];
};

/** One writer, as it appears in a prompt. */
export function renderWriter(writer: SectionWriter): string {
  const lines = [
    `### ${writer.key.toUpperCase()}`,
    "",
    `PURPOSE: ${writer.purpose}`,
    "",
    "STRUCTURE:",
    writer.structure,
    "",
    "VOICE:",
    writer.voice,
  ];

  if (writer.devices.length > 0) {
    lines.push("", `DEVICES THAT SUIT THIS SECTION: ${writer.devices.join(", ")}.`);
  }

  if (writer.forbidden.length > 0) {
    lines.push("", "NEVER, IN THIS SECTION:");
    for (const rule of writer.forbidden) lines.push(`- ${rule}`);
  }

  if (writer.examples.length > 0) {
    lines.push(
      "",
      "REAL EXAMPLES from this author's published posts. STYLE ONLY.",
      "Study the rhythm and the kind of detail. Never reuse their words, images,",
      "jokes, ingredients, or methods. Those dishes are not this recipe:",
    );
    for (const example of writer.examples) lines.push(`  "${example}"`);
  }

  if (writer.checklist.length > 0) {
    lines.push("", "BEFORE YOU ANSWER, CHECK:");
    for (const item of writer.checklist) lines.push(`- ${item}`);
  }

  return lines.join("\n");
}
