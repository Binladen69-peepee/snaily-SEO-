/**
 * Gutenberg-compatible markup for WordPress drafts.
 *
 * Cinnamon Snail posts are stored as `<!-- wp:paragraph -->` / `<!-- wp:image -->`
 * blocks (plus Feast / WP Recipe Maker / Yoast FAQ). Drafter keeps HTML in the
 * editor; this converter wraps that HTML so `wp_insert_post` lands as blocks
 * instead of Classic blobs.
 *
 * Already-blocked content is left alone.
 */

const BLOCKED = /<!--\s+wp:/i;

function attrJson(attrs: Record<string, unknown>): string {
  const keys = Object.keys(attrs);
  if (keys.length === 0) return "";
  return ` ${JSON.stringify(attrs)}`;
}

function block(name: string, inner: string, attrs: Record<string, unknown> = {}): string {
  return `<!-- wp:${name}${attrJson(attrs)} -->\n${inner}\n<!-- /wp:${name} -->`;
}

function sizeSlugFromWidth(width: number | null): "small" | "medium" | "large" | "full" {
  if (width === null || width <= 0) return "large";
  if (width <= 320) return "small";
  if (width <= 640) return "medium";
  if (width >= 1200) return "full";
  return "large";
}

function imgBlock(tag: string): string {
  const src = /src="([^"]+)"/i.exec(tag)?.[1] ?? "";
  const alt = /alt="([^"]*)"/i.exec(tag)?.[1] ?? "";
  const widthRaw = /(?:data-width|width)="(\d+)"/i.exec(tag)?.[1];
  const width = widthRaw ? Number(widthRaw) : null;
  const slugAttr = /data-size="(small|medium|large|full)"/i.exec(tag)?.[1];
  const sizeSlug = (slugAttr as "small" | "medium" | "large" | "full" | undefined)
    ?? sizeSlugFromWidth(width);
  const align = /data-align="(left|center|right)"/i.exec(tag)?.[1];
  const className = [
    "wp-block-image",
    `size-${sizeSlug}`,
    align ? `align${align}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const widthAttr = width && width > 0 ? ` width="${String(width)}"` : "";
  const inner = `<figure class="${className}"><img src="${src}" alt="${alt}"${widthAttr}/></figure>`;
  const attrs: Record<string, unknown> = {
    sizeSlug,
    linkDestination: "none",
  };
  if (align) attrs.align = align;
  return block("image", inner, attrs);
}

function wrapElement(html: string): string {
  const trimmed = html.trim();
  if (trimmed === "") return "";

  if (/^<h1\b/i.test(trimmed)) {
    return block("heading", trimmed, { level: 1 });
  }
  if (/^<h2\b/i.test(trimmed)) {
    return block("heading", trimmed, { level: 2 });
  }
  if (/^<h3\b/i.test(trimmed)) {
    return block("heading", trimmed, { level: 3 });
  }
  if (/^<h4\b/i.test(trimmed)) {
    return block("heading", trimmed, { level: 4 });
  }
  if (/^<(ul|ol)\b/i.test(trimmed)) {
    return block("list", trimmed, {
      ordered: /^<ol\b/i.test(trimmed),
    });
  }
  if (/^<blockquote\b/i.test(trimmed)) {
    return block("quote", trimmed);
  }
  if (/^<hr\b/i.test(trimmed)) {
    return block("separator", "<hr class=\"wp-block-separator has-alpha-channel-opacity\"/>");
  }
  if (/^<table\b/i.test(trimmed)) {
    return block("table", `<figure class="wp-block-table">${trimmed}</figure>`);
  }
  if (/^<img\b/i.test(trimmed)) {
    return imgBlock(trimmed);
  }
  if (/^<figure\b/i.test(trimmed)) {
    const img = /<img\b[^>]*>/i.exec(trimmed)?.[0];
    return img ? imgBlock(img) : block("paragraph", `<p>${trimmed}</p>`);
  }
  if (/^<p\b/i.test(trimmed)) {
    return block("paragraph", trimmed);
  }
  return block("paragraph", `<p>${trimmed}</p>`);
}

/**
 * Split a stored editor body into top-level tags. Comments (<!-- ... -->)
 * are skipped so Gutenberg round-trips stay intact.
 */
function topLevel(html: string): string[] {
  const parts: string[] = [];
  const re = /<(p|h[1-6]|ul|ol|blockquote|figure|img|hr|table|div)\b[^>]*>[\s\S]*?<\/\1>|<img\b[^>]*>|<hr\b[^>]*\/?>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const gap = html.slice(last, m.index).trim();
    if (gap !== "" && !gap.startsWith("<!--")) {
      parts.push(`<p>${gap}</p>`);
    }
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  const tail = html.slice(last).trim();
  if (tail !== "" && !tail.startsWith("<!--")) {
    parts.push(`<p>${tail}</p>`);
  }
  return parts;
}

export function htmlToGutenberg(html: string): string {
  const trimmed = html.trim();
  if (trimmed === "") return "";
  if (BLOCKED.test(trimmed)) return trimmed;
  return topLevel(trimmed)
    .map(wrapElement)
    .filter((s) => s !== "")
    .join("\n\n");
}

/** Strip Gutenberg comments for the on-site preview (HTML only). */
export function gutenbergToPreviewHtml(html: string): string {
  return html
    .replace(/<!--\s+\/?wp:[^>]*-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
