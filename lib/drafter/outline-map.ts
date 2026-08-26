/**
 * What sections a draft actually has, and which the template expects.
 *
 * The generator asks for two sections in one call and files whatever comes
 * back, so a reply that answered only half the request lost the other half
 * silently — a Moroccan sweet potato soup shipped with no specialty
 * ingredients section at all, and nothing in the editor said so. Reading the
 * headings back out of the finished document is the check that would have
 * caught it, and it is cheap: the answer is in the prose.
 *
 * Pure string work, no model and no network, so the editor can run it on every
 * keystroke and the tests can run it on fixtures.
 */

import { classifyHeading, SECTION_LABELS, type SectionKey } from "@/lib/wordpress/sections";

/** The order the client's own posts run in. */
export const EXPECTED_SECTIONS: SectionKey[] = [
  "why",
  "ingredients",
  "variations",
  "how-to-make",
  "serving",
  "tips",
  "faqs",
  "related",
];

/**
 * Sections a post is wrong without.
 *
 * Narrower than EXPECTED_SECTIONS: variations and related are good to have,
 * but a post without them is a shorter post, not a broken one. A post with no
 * ingredients section is missing the part the reader came for.
 */
export const REQUIRED_SECTIONS: SectionKey[] = [
  "why",
  "ingredients",
  "how-to-make",
  "serving",
  "tips",
  "faqs",
];

export type OutlineEntry = {
  /** Heading text exactly as written, emoji included. */
  heading: string;
  /** Which section this is, when it maps onto a known one. */
  key: SectionKey | null;
  /** Index of the heading in the document, for scroll-to. */
  index: number;
};

export type MissingSection = {
  key: SectionKey;
  label: string;
  required: boolean;
};

export type OutlineMap = {
  entries: OutlineEntry[];
  missing: MissingSection[];
  /** Present sections over expected ones, for the "8 of 9" style counter. */
  present: number;
  expected: number;
};

const H2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;

/** Heading text with tags and entities stripped, whitespace collapsed. */
function headingText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read a document's H2s and work out what is missing.
 *
 * An unrecognised heading is kept in `entries` with a null key — the author is
 * allowed headings the template has no name for, and hiding them from the
 * navigator would make it lie about the document.
 */
export function outlineMap(content: string): OutlineMap {
  const entries: OutlineEntry[] = [];
  const seen = new Set<SectionKey>();

  let index = 0;
  for (const match of content.matchAll(H2)) {
    const heading = headingText(match[1] ?? "");
    if (heading === "") continue;
    const key = classifyHeading(heading);
    if (key !== null) seen.add(key);
    entries.push({ heading, key, index });
    index += 1;
  }

  const missing: MissingSection[] = EXPECTED_SECTIONS.filter(
    (k) => !seen.has(k),
  ).map((key) => ({
    key,
    label: SECTION_LABELS[key],
    required: REQUIRED_SECTIONS.includes(key),
  }));

  const present = EXPECTED_SECTIONS.filter((k) => seen.has(k)).length;

  return { entries, missing, present, expected: EXPECTED_SECTIONS.length };
}
