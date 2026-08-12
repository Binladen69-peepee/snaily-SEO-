/**
 * The small slice of Markdown the AI actually returns, converted to HTML.
 *
 * Deliberately not a full Markdown parser — the model is instructed to produce
 * headings, paragraphs, lists, emphasis and links, and nothing here needs to
 * handle tables or footnotes. A dependency for six rules would not earn itself.
 *
 * Output is fed through the editor's schema, which drops anything it does not
 * recognise, so this does not need to be a sanitiser as well.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Inline emphasis, code and links, applied after escaping. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img src="$2" alt="$1">')
    // Only http(s) links survive; anything else (javascript:, data:) is left
    // as plain text rather than becoming an anchor.
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)[^)]*\)/g,
      '<a href="$2">$1</a>',
    );
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown
    .replace(/^```(?:\w+)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .split(/\r?\n/);

  const out: string[] = [];
  let list: "ul" | "ol" | null = null;

  const closeList = () => {
    if (list !== null) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      closeList();
      continue;
    }

    /*
     * A line that is nothing but an image becomes a top-level <img>.
     *
     * Wrapping it in <p> is what broke images in the editor: the Image node is
     * block-level, so the schema refuses it inside a paragraph and silently
     * drops it — leaving the bare URL behind as text, which is exactly what a
     * generated article looked like.
     */
    const loneImage = /^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)[^)]*\)$/.exec(
      line.trim(),
    );
    if (loneImage) {
      closeList();
      out.push(
        `<img src="${escapeHtml(loneImage[2]!)}" alt="${escapeHtml(loneImage[1]!)}">`,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      // H1 belongs to the article title field, so a generated "#" becomes H2
      // rather than competing with it.
      const level = Math.max(2, heading[1]!.length);
      out.push(`<h${String(level)}>${inline(heading[2]!)}</h${String(level)}>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(ordered[1]!)}</li>`);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      out.push(`<blockquote><p>${inline(quote[1]!)}</p></blockquote>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  return out.join("");
}

/** True when a stored body is already HTML rather than legacy Markdown. */
export function looksLikeHtml(content: string): boolean {
  return /<(p|h[1-6]|ul|ol|blockquote|img|div|pre)\b/i.test(content);
}

/** Normalises a stored body into HTML the editor can load. */
export function toEditorHtml(content: string): string {
  const trimmed = content.trim();
  if (trimmed === "") return "";
  return looksLikeHtml(trimmed) ? trimmed : markdownToHtml(trimmed);
}
