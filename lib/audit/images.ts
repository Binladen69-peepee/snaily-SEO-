/**
 * Which images on a page actually need alt text.
 *
 * The first version of this counted every `<img>` whose alt was absent *or
 * empty*, across the whole document. That is wrong twice over, and the client
 * saw both failures at once on cinnamonsnail.com/vegan-recipes: 30 of 84
 * images "missing alt text", every one of them a Feast category-index
 * thumbnail carrying `alt=""` inside a link whose own text already names the
 * recipe.
 *
 * `alt=""` is not a missing alt. It is the markup that tells a screen reader
 * to skip an image on purpose, and it is exactly right for a thumbnail sitting
 * inside a link that already has an accessible name. Reporting it as a defect
 * asks the author to make their markup worse.
 *
 * So an image is judged three ways:
 *   - chrome      navigation, header, footer, sidebar, widget: not the post's
 *                 content, and not something the author edits per-post
 *   - decorative  deliberately marked as carrying no information
 *   - content     a real content image, which must have a real alt
 *
 * Only a content image with no alt attribute at all is a defect.
 */

import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";

export type ImageVerdict = "content" | "decorative" | "chrome";

export type ImageAudit = {
  /** Content images considered by the audit (chrome excluded). */
  total: number;
  /** Content images with no alt attribute at all — the real defect. */
  missingAlt: number;
  /** Images deliberately marked as decorative, which is correct markup. */
  decorative: number;
  /** Images belonging to site chrome rather than the page's own content. */
  chrome: number;
  /**
   * The `src` of each content image with no alt attribute.
   *
   * A count alone says a page has a problem; it does not say which image, and
   * a fix has to name the thing it is fixing. These are the exact sources the
   * audit objected to, so the media item behind each one can be found and
   * given alt text.
   */
  missingAltSrc: string[];
};

/**
 * Containers whose images are site furniture rather than page content.
 * Matched on the element's own tag or any ancestor's class/id.
 */
const CHROME_TAGS = new Set(["header", "footer", "nav", "aside"]);

const CHROME_PATTERN =
  /(^|[-_ ])(nav|navbar|menu|sidebar|widget|breadcrumb|footer|header|masthead|social|share|logo|avatar|gravatar|banner|advert|promo|related|recirc|carousel|slider|pagination|feast-category-index|feast-nav|site-branding|skip-link|cookie|newsletter|subscribe)([-_ ]|$)/i;

/** Where a page's own content lives, most specific first. */
const CONTENT_ROOTS = [
  ".entry-content",
  ".post-content",
  ".article-content",
  "article .content",
  "main article",
  "article",
  "main",
  "[role='main']",
];

/** Spacer / tracking assets that never carry meaning. */
const PIXEL_SRC =
  /(^data:image\/gif;base64,R0lGOD)|(\/(spacer|blank|pixel|clear|transparent|1x1|px)\.(gif|png|webp))|(\/(pixel|track|beacon|impression|collect)(\/|\?|$))/i;

function attr(el: Cheerio<Element>, name: string): string | undefined {
  const value = el.attr(name);
  return value === undefined ? undefined : value;
}

/** A number written into width/height, when it is a plain number. */
function dimension(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when the element sits inside site chrome rather than page content.
 *
 * Ancestors are only walked up to `root`. Walking all the way to `<html>`
 * excluded every image on every post of the client's site: the Genesis theme
 * wraps the article in `div.content-sidebar-wrap`, whose class contains
 * "sidebar" as a layout name, not as a sidebar. Once the content root is
 * known, everything above it is layout and tells us nothing.
 */
export function isChrome(
  $: CheerioAPI,
  el: Cheerio<Element>,
  root?: Cheerio<Element> | null,
): boolean {
  const chain =
    root !== undefined && root !== null && root.length > 0
      ? el.parentsUntil(root)
      : el.parents();

  let hit = false;
  chain.each((_, parent) => {
    if (hit) return;
    const tag = (parent as Element).tagName?.toLowerCase() ?? "";
    if (CHROME_TAGS.has(tag)) {
      hit = true;
      return;
    }
    const $parent = $(parent);
    const cls = $parent.attr("class") ?? "";
    const id = $parent.attr("id") ?? "";
    if (CHROME_PATTERN.test(cls) || CHROME_PATTERN.test(id)) hit = true;
  });
  return hit;
}

/**
 * Whether this image is decorative — carries no information a reader would
 * miss. Deliberate authoring (`alt=""`, `role="presentation"`,
 * `aria-hidden`) counts, and so do spacer and tracking assets.
 */
export function isDecorative(el: Cheerio<Element>): boolean {
  if ((attr(el, "aria-hidden") ?? "").toLowerCase() === "true") return true;

  const role = (attr(el, "role") ?? "").toLowerCase();
  if (role === "presentation" || role === "none") return true;

  // An alt that is present but empty is the author saying "skip this".
  const alt = attr(el, "alt");
  if (alt !== undefined && alt.trim() === "") return true;

  const src = attr(el, "src") ?? attr(el, "data-src") ?? "";
  if (src !== "" && PIXEL_SRC.test(src)) return true;

  // A tracking pixel, whatever it is called.
  const w = dimension(attr(el, "width"));
  const h = dimension(attr(el, "height"));
  if (w !== null && h !== null && w <= 2 && h <= 2) return true;

  return false;
}

/** Classify one image, relative to the page's content root when it has one. */
export function classifyImage(
  $: CheerioAPI,
  el: Cheerio<Element>,
  root?: Cheerio<Element> | null,
): ImageVerdict {
  if (isChrome($, el, root)) return "chrome";
  if (isDecorative(el)) return "decorative";
  return "content";
}

/**
 * Count the images on a loaded document, splitting real defects from markup
 * that is already correct.
 *
 * Images are read from the page's content root when it has one, so a theme's
 * related-posts grid or category index cannot inflate the count of a post.
 */
export function auditImages($: CheerioAPI): ImageAudit {
  let root: Cheerio<Element> | null = null;
  for (const selector of CONTENT_ROOTS) {
    const found = $(selector).first();
    if (found.length > 0) {
      root = found as Cheerio<Element>;
      break;
    }
  }

  const images = (root ?? $("body")).find("img");

  const out: ImageAudit = {
    total: 0,
    missingAlt: 0,
    decorative: 0,
    chrome: 0,
    missingAltSrc: [],
  };

  images.each((_, node) => {
    const el = $(node) as Cheerio<Element>;
    const verdict = classifyImage($, el, root);

    if (verdict === "chrome") {
      out.chrome += 1;
      return;
    }
    if (verdict === "decorative") {
      out.decorative += 1;
      return;
    }

    out.total += 1;
    // Content image with no alt attribute at all: the genuine defect.
    if (attr(el, "alt") === undefined) {
      out.missingAlt += 1;
      const src = attr(el, "src") ?? attr(el, "data-src") ?? "";
      if (src !== "" && !out.missingAltSrc.includes(src)) {
        out.missingAltSrc.push(src);
      }
    }
  });

  return out;
}
