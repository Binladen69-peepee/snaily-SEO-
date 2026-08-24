/**
 * Shaping a written section into the markup the template renders.
 *
 * Separate from the writing rules on purpose. A prompt can ask for a shape and
 * will mostly get it; the places where "mostly" shows up on a published post
 * are handled here instead, as ordinary string functions with tests.
 */

/**
 * Turns a Markdown list into one paragraph per item.
 *
 * "Why you'll adore this recipe" is written as a run of emoji-led lines, and
 * writing them as `- 🥰 **Heading:** text` is the obvious thing for a model to
 * do. The editor's own CSS hides the markers, so the draft looked like
 * paragraphs — but the export maps a `<ul>` onto a WordPress list block, and
 * the section arrived on the site as a bulleted list, which is not how any of
 * the client's published posts render it.
 *
 * Only leading bullet markers go. The text of each item, emoji and bold and
 * all, is left exactly as written.
 */
export function bulletsToParagraphs(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const item = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.*)$/.exec(line);
    if (item === null) {
      out.push(line);
      continue;
    }

    // A paragraph needs a blank line before it, but not two.
    if (out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
    out.push(item[1]!.trim());
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
