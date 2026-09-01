/**
 * The four posts the Feast grid will show, resolved once.
 *
 * "You'll also love these…" is the way out of a post, and on the client's
 * template it is not prose at all — it is a Feast FSRI block that takes a
 * comma-separated list of real WordPress post IDs and renders them as image
 * cards. So the section has exactly one job: name four recipes that exist.
 *
 * Until now those IDs were worked out at export time and nowhere else, which
 * meant the document the author read listed recipe names while the post that
 * shipped showed a grid chosen by code they never saw. If a name did not
 * resolve, they found out after publishing, by looking at the page.
 *
 * This module is the single answer to "which four posts". The document prints
 * what it returns and the exporter sends what it returns, so the two cannot
 * disagree.
 *
 * Nothing here guesses. A name that does not match a synced published post is
 * left out — an FSRI block pointed at an ID that does not exist renders an
 * empty card on a live page.
 */

import { resolveTarget, type LinkIndex } from "@/lib/content/link-index";
import { classifyHeading } from "@/lib/wordpress/sections";

/** The Feast grid renders four cards. */
export const FSRI_CARDS = 4;

/**
 * Shortest title allowed to match on its text alone.
 *
 * A short title matches prose by accident — "Vegan Chili" appears inside half
 * the sentences on a chili post. Anything shorter than this has to arrive as a
 * link or a list item, where the author's intent is explicit.
 */
const MIN_TITLE_MATCH = 14;

export type RelatedPost = {
  /** A real WordPress post ID, from a synced published post. */
  wpId: number;
  title: string;
};

function stripText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The "you'll also love these" section of a rendered article, as HTML.
 *
 * Returns an empty string when the article has no such section — which is a
 * real answer, and the reason the caller can tell "nothing resolved" apart
 * from "there was nothing to resolve".
 */
export function relatedSectionHtml(articleHtml: string): string {
  const parts = articleHtml.split(/(?=<h2\b)/i);
  for (const part of parts) {
    const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(part);
    if (heading === null) continue;
    if (classifyHeading(stripText(heading[1] ?? "")) !== "related") continue;
    return part;
  }
  return "";
}

/**
 * Resolve the recipes named in that section to real post IDs.
 *
 * Anchors are read first because the internal-link pass has already verified
 * them, then bare list items, which is how the author usually writes the
 * section before links are added. Duplicates collapse: the same recipe named
 * twice is one card, not two.
 */
export function resolveRelatedPosts(
  index: LinkIndex,
  sectionHtml: string,
): RelatedPost[] {
  if (sectionHtml === "" || index.all.length === 0) return [];

  const found = new Map<number, string>();

  for (const m of sectionHtml.matchAll(
    /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const target = resolveTarget(index, m[1] ?? "", stripText(m[2] ?? ""));
    if (target) found.set(target.wpId, target.title);
  }

  for (const m of sectionHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = stripText(m[1] ?? "");
    if (text === "") continue;
    const target = resolveTarget(index, "", text);
    if (target) found.set(target.wpId, target.title);
  }

  /*
   * Last, any published title written out in full inside this section.
   *
   * The writer is asked for a bullet list and does not always produce one: a
   * real draft put four correct recipe names into a single run-on paragraph,
   * two of which the link pass happened to anchor. The other two were plain
   * text with no delimiter between them, so there was no list item to read and
   * no anchor to follow — and all four posts existed. Two cards were lost to
   * markup rather than to anything being wrong with the names.
   *
   * Matching a full title inside this one section is not a guess about what
   * the author meant: naming a recipe here is the entire purpose of the
   * section. Long titles go first so "Vegan Chili" cannot claim a mention of
   * "Easy Vegan Chili Recipe", and short titles are skipped entirely because a
   * two-word title matches prose by accident.
   */
  if (found.size < FSRI_CARDS) {
    const text = stripText(sectionHtml).toLowerCase();
    const candidates = index.all
      .filter((t) => t.type !== "category" && t.title.trim().length >= MIN_TITLE_MATCH)
      .sort((a, b) => b.title.length - a.title.length);

    for (const target of candidates) {
      if (found.size >= FSRI_CARDS) break;
      if (found.has(target.wpId)) continue;
      if (text.includes(target.title.toLowerCase().trim())) {
        found.set(target.wpId, target.title);
      }
    }
  }

  return [...found.entries()]
    .slice(0, FSRI_CARDS)
    .map(([wpId, title]) => ({ wpId, title }));
}
