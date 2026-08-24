/**
 * Turning mentions of the client's own recipes into links.
 *
 * The generation stages are told not to write links at all. That is deliberate:
 * a model asked for a URL invents one, and a model asked for a relative slug
 * invents that instead, so the prose ends up depending on targets that have to
 * be torn out again. Instead the prose names sibling recipes in plain words —
 * which it can do honestly, because it is given the real list — and this runs
 * afterwards over the finished HTML.
 *
 * Every anchor written here points at a post the project actually synced from
 * WordPress. There is no fallback that guesses a slug.
 */

import { editableRuns, findTermMatch } from "@/lib/content/html-runs";
import type { LinkIndex, LinkTarget } from "@/lib/content/link-index";
import { classifyHeading, type SectionKey } from "@/lib/wordpress/sections";

export type InsertedLink = { anchor: string; url: string; title: string };

export type InsertResult = {
  html: string;
  inserted: InsertedLink[];
  /** Recipes named in the prose that no synced post matches. */
  unmatched: string[];
};

/**
 * How many words a title must have before it is safe to match on.
 *
 * A one-word post title like "Bread" would link every incidental mention of
 * bread in the article, which reads as spam and buries the links that matter.
 */
const MIN_TITLE_WORDS = 2;

/** Never link the same target twice, and never more than this in one post. */
const MAX_LINKS = 24;

/**
 * How many links each section may carry.
 *
 * Measured against a finished post, the distribution was 0 in the intro, 0 in
 * "why you'll adore", 0 in the FAQ, and everything else piled into the two
 * sections that happened to name the most dishes. That is what an uncapped
 * first-mention pass does: whichever section names a recipe first takes the
 * link, and the reader gets ten of them in a row followed by nothing.
 *
 * These are ceilings, not targets — a section that names nothing still links
 * nothing. The prompts are what give each section something worth naming.
 */
const SECTION_CAP: Partial<Record<SectionKey, number>> = {
  intro: 3,
  why: 2,
  ingredients: 4,
  variations: 4,
  "how-to-make": 1,
  serving: 8,
  tips: 2,
  faqs: 1,
  related: 6,
};

const DEFAULT_CAP = 3;

/**
 * The recipe card is a structured block WordPress renders from its own plugin,
 * and an anchor dropped into it survives export as stray markup inside a field
 * that expects plain text. The FAQ used to be excluded for the same reason;
 * it is allowed one link now that the export writes the schema copy of an
 * answer as plain text and the rendered copy as HTML.
 */
const SKIP_HEADING = /^\s*recipe\b/i;

type Region = { from: number; to: number; key: SectionKey | null };

/**
 * The parts of the document links may be inserted into.
 *
 * The recipe card and the FAQ are excluded: the card is a structured block that
 * WordPress renders from its own plugin, and an anchor dropped into it survives
 * export as stray markup inside a field that expects plain text.
 */
function linkableRegions(html: string): Region[] {
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  if (headings.length === 0) {
    return [{ from: 0, to: html.length, key: null }];
  }

  const regions: Region[] = [];

  // Everything above the first H2 is the hook and the intro.
  const firstHeading = headings[0]!.index ?? 0;
  if (firstHeading > 0) regions.push({ from: 0, to: firstHeading, key: "intro" });

  headings.forEach((m, i) => {
    const text = (m[1] ?? "").replace(/<[^>]+>/g, "").trim();
    if (SKIP_HEADING.test(text)) return;
    const from = (m.index ?? 0) + m[0].length;
    const to = headings[i + 1]?.index ?? html.length;
    regions.push({ from, to, key: classifyHeading(text) });
  });

  return regions;
}

function capFor(key: SectionKey | null): number {
  if (key === null) return DEFAULT_CAP;
  return SECTION_CAP[key] ?? DEFAULT_CAP;
}

/**
 * Sections where pointing at a whole category reads naturally.
 *
 * The client's own posts do this in exactly one place - the "Vegan AF" and
 * "Tested and Approved Worldwide" lines, which say "like all of my vegan Thai
 * recipes" and link the archive. Anywhere else it reads as filler, so a
 * category is only ever a candidate in these two sections.
 */
const CATEGORY_SECTIONS: ReadonlySet<SectionKey> = new Set(["why", "ingredients"]);

/** Titles long enough to be distinctive, longest first so the best match wins. */
function candidates(index: LinkIndex, key: SectionKey | null): LinkTarget[] {
  const allowCategory = key !== null && CATEGORY_SECTIONS.has(key);

  return index.all
    .filter((t) => t.type === "post" || (allowCategory && t.type === "category"))
    .filter((t) => t.title.trim().split(/\s+/).length >= MIN_TITLE_WORDS)
    .sort((a, b) => b.title.length - a.title.length);
}

/**
 * A title as it is likely to appear in prose.
 *
 * Published titles carry suffixes the sentence will not — "Vegan Ginger Cake
 * (One Bowl!)" is written about as "vegan ginger cake". Matching on the bare
 * stem finds the mention; the anchor still points at the real post.
 */
function searchTerms(target: LinkTarget): string[] {
  const title = target.title.trim();
  const stem = title
    .replace(/\s*[([].*$/, "")
    .replace(/\s*[|–-]\s.*$/, "")
    .replace(/\s*recipe\s*$/i, "")
    .trim();

  /*
   * The stem is tried first on purpose.
   *
   * Both can be present in the same paragraph, and whichever matches becomes
   * the anchor. Preferring the full published title produced anchors like
   * "Easy Vegan Tofu Chili Recipe" sitting mid-sentence in Title Case, which
   * reads as a link farm rather than as someone mentioning a recipe. The stem
   * is what a person writes when they say it out loud, so it wins where the
   * prose offers both.
   */
  const terms: string[] = [];
  if (stem !== title && stem.split(/\s+/).length >= MIN_TITLE_WORDS) {
    terms.push(stem);
  }
  terms.push(title);
  return terms;
}

/**
 * Links the first plain-text mention of each published recipe.
 *
 * Two passes on purpose. Targets are allocated in document order, so the intro
 * gets its pick before the serving section takes everything; the rewritten
 * slices are then spliced back in from the end, so earlier offsets stay valid
 * as later slices grow.
 */
export function insertInternalLinks(
  html: string,
  index: LinkIndex,
  namedInProse: string[] = [],
): InsertResult {
  if (index.all.length === 0) {
    return { html, inserted: [], unmatched: [] };
  }

  const inserted: InsertedLink[] = [];
  const usedUrls = new Set<string>();

  const regions = linkableRegions(html);
  const slices = regions.map((region) => html.slice(region.from, region.to));

  regions.forEach((region, r) => {
    const cap = capFor(region.key);
    let placed = 0;
    let slice = slices[r]!;

    for (const target of candidates(index, region.key)) {
      if (placed >= cap) break;
      if (inserted.length >= MAX_LINKS) break;
      if (usedUrls.has(target.url)) continue;

      for (const term of searchTerms(target)) {
        const hit = findTermMatch(slice, term);
        if (hit === null) continue;

        slice =
          slice.slice(0, hit.start) +
          `<a href="${target.url}">${hit.text}</a>` +
          slice.slice(hit.end);

        usedUrls.add(target.url);
        placed += 1;
        inserted.push({ anchor: hit.text, url: target.url, title: target.title });
        break;
      }
    }

    slices[r] = slice;
  });

  let out = html;
  for (let r = regions.length - 1; r >= 0; r -= 1) {
    const region = regions[r]!;
    out = out.slice(0, region.from) + slices[r]! + out.slice(region.to);
  }

  /*
   * Recipes the prose named that nothing matches. Reported, never invented: a
   * dish the author mentions which is not on the site yet is a content
   * opportunity, and it is not this pass's business to guess a URL for it.
   */
  const linkedTitles = new Set(inserted.map((i) => i.title.toLowerCase()));
  const unmatched = namedInProse
    .map((n) => n.trim())
    .filter((n) => n !== "" && !linkedTitles.has(n.toLowerCase()))
    .filter((n) => !index.all.some((t) => t.title.toLowerCase() === n.toLowerCase()));

  return { html: out, inserted, unmatched: [...new Set(unmatched)].slice(0, 20) };
}

/** Raw URLs and leftover Markdown links have no business in finished prose. */
export function findRawLinkArtifacts(html: string): string[] {
  const problems: string[] = [];

  for (const run of editableRuns(html)) {
    const text = html.slice(run.from, run.to);
    for (const m of text.matchAll(/\[[^\]]{2,80}\]\([^)]{2,200}\)/g)) {
      problems.push(m[0].slice(0, 80));
    }
    for (const m of text.matchAll(/https?:\/\/\S{4,}/g)) {
      problems.push(m[0].slice(0, 80));
    }
  }

  return [...new Set(problems)].slice(0, 10);
}
