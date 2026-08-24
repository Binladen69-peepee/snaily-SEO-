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
    /*
     * Absolute http(s) links, and root-relative paths like /vegan-ginger-cake/.
     *
     * Relative paths used to be excluded here while the section playbook was
     * telling the model to write exactly that form, so every internal link the
     * Drafter produced survived into the published article as visible Markdown:
     * "[Vegan Ginger Cake](/vegan-ginger-cake/)".
     *
     * `\/(?!\/)` allows "/path" but not "//evil.com" — a protocol-relative URL
     * would leave the site. Everything else (javascript:, data:, vbscript:)
     * still falls through to plain text rather than becoming an anchor.
     */
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/(?!\/)[^)\s]*)[^)]*\)/g,
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
  /*
   * Consecutive prose lines belong to one paragraph, as they do in Markdown
   * itself. Emitting a <p> per line looked right while models returned one
   * long line per paragraph, and shredded a paragraph into fragments the
   * moment one wrapped at 80 columns — which then reached WordPress as four
   * one-line paragraphs in a row.
   */
  let para: string[] = [];

  const closeList = () => {
    if (list !== null) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  const closePara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };

  const closeBlock = () => {
    closePara();
    closeList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      closeBlock();
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
      closeBlock();
      out.push(
        `<img src="${escapeHtml(loneImage[2]!)}" alt="${escapeHtml(loneImage[1]!)}">`,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeBlock();
      // H1 belongs to the article title field, so a generated "#" becomes H2
      // rather than competing with it.
      const level = Math.max(2, heading[1]!.length);
      out.push(`<h${String(level)}>${inline(heading[2]!)}</h${String(level)}>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      closePara();
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
      closePara();
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
      closeBlock();
      out.push(`<blockquote><p>${inline(quote[1]!)}</p></blockquote>`);
      continue;
    }

    closeList();
    para.push(line.trim());
  }

  closeBlock();
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
