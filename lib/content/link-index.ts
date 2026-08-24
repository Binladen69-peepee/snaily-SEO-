import { prisma } from "@/lib/db";

/**
 * Verified internal-link index.
 *
 * Every entry comes from a post this project actually synced from WordPress, so
 * a resolved link always points at a page that exists. The Drafter writes
 * relative Markdown from the section playbook — `[Vegan Ginger Cake](/vegan-ginger-cake/)`
 * — and those targets are guesses by the model, not facts. This turns a guess
 * into either a real URL or nothing at all.
 *
 * Source priority, as agreed with the client:
 *   1. Connected WordPress content (implemented here — `WpPost`)
 *   2. Client-provided spreadsheet   (not built; needs the file)
 *   3. Sitemap crawl                 (not built; WordPress covers it today)
 *
 * The one rule that matters: never invent a URL. An unresolved link is dropped
 * to plain text and reported as an opportunity, never left as a broken anchor
 * and never guessed at from the slug.
 */

export type LinkTarget = {
  title: string;
  url: string;
  slug: string;
  /** WordPress post ID — real, never synthesised. */
  wpId: number;
  type: string;
  /** Lowercased title words, for loose matching. */
  terms: string[];
};

export type LinkIndex = {
  bySlug: Map<string, LinkTarget>;
  byTitle: Map<string, LinkTarget>;
  all: LinkTarget[];
};

/** Trailing/leading slashes and case make slugs compare unequal for no reason. */
export function normaliseSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
}

function normaliseTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds the index for one project.
 *
 * Published posts and pages only — a draft has no public URL, so linking to one
 * would produce a 404 for every reader.
 */
export async function buildLinkIndex(projectId: string): Promise<LinkIndex> {
  const [rows, terms] = await Promise.all([
    prisma.wpPost.findMany({
      where: { projectId, status: "publish" },
      select: { wpId: true, title: true, slug: true, link: true, type: true },
      orderBy: { publishedAt: "desc" },
    }),
    /*
     * Category archives, so "like all of my vegan Thai recipes" has somewhere
     * real to point. They carry `type: "category"` and the link pass decides
     * which sections may use one - a category link reads naturally in the
     * "why you'll adore" bullets and as clutter in a method step.
     */
    prisma.wpTerm.findMany({
      where: { projectId, taxonomy: "category" },
      select: { wpId: true, name: true, slug: true, link: true },
      orderBy: { count: "desc" },
    }),
  ]);

  const bySlug = new Map<string, LinkTarget>();
  const byTitle = new Map<string, LinkTarget>();
  const all: LinkTarget[] = [];

  for (const row of rows) {
    // A row without a real permalink cannot be linked to, full stop.
    if (row.link.trim() === "" || row.title.trim() === "") continue;

    const target: LinkTarget = {
      title: row.title,
      url: row.link,
      slug: normaliseSlug(row.slug !== "" ? row.slug : row.link),
      wpId: row.wpId,
      type: row.type,
      terms: normaliseTitle(row.title).split(" ").filter((w) => w.length > 2),
    };

    all.push(target);
    if (target.slug !== "" && !bySlug.has(target.slug)) bySlug.set(target.slug, target);
    const t = normaliseTitle(target.title);
    if (t !== "" && !byTitle.has(t)) byTitle.set(t, target);
  }

  for (const term of terms) {
    if (term.link.trim() === "" || term.name.trim() === "") continue;

    all.push({
      title: term.name,
      url: term.link,
      slug: normaliseSlug(term.slug !== "" ? term.slug : term.link),
      wpId: term.wpId,
      type: "category",
      terms: normaliseTitle(term.name).split(" ").filter((w) => w.length > 2),
    });
  }

  return { bySlug, byTitle, all };
}

/**
 * Finds the page a Markdown link was aiming at.
 *
 * Tried in order of confidence: the exact slug the model wrote, the exact
 * anchor text as a title, then a word-overlap match. The overlap threshold is
 * deliberately high — a weak guess linking "vegan ginger cake" to a chickpea
 * curry is worse for the reader than no link.
 */
export function resolveTarget(
  index: LinkIndex,
  href: string,
  anchor: string,
): LinkTarget | null {
  const slug = normaliseSlug(href);
  if (slug !== "") {
    const bySlug = index.bySlug.get(slug);
    if (bySlug) return bySlug;
  }

  const title = normaliseTitle(anchor);
  if (title !== "") {
    const exact = index.byTitle.get(title);
    if (exact) return exact;
  }

  const words = title.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return null;

  let best: { target: LinkTarget; score: number } | null = null;
  for (const target of index.all) {
    if (target.terms.length === 0) continue;
    const hits = words.filter((w) => target.terms.includes(w)).length;
    // Score against the shorter side so a long title cannot dilute a real match.
    const score = hits / Math.min(words.length, target.terms.length);
    if (score > (best?.score ?? 0)) best = { target, score };
  }

  return best !== null && best.score >= 0.75 ? best.target : null;
}

export type LinkResolution = {
  html: string;
  resolved: { anchor: string; url: string }[];
  /** Links the model wanted that no real page matches. */
  unresolved: { anchor: string; href: string }[];
};

/**
 * Any anchor, whatever order its attributes are written in.
 *
 * This used to require `href` to be the very first attribute, which was true
 * of the anchors the pipeline writes and false of the ones that come back out
 * of the editor: TipTap re-renders a link as
 * `<a target="_blank" rel="..." href="...">`, so on a real exported post this
 * matched 0 of 18 anchors. Nothing looked broken — the links were still in the
 * HTML — but the pass that verifies them and strips the unverifiable ones was
 * running over a document it could not see, and the export reported "0
 * internal links" for a post that had eight.
 */
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF = /(?:^|\s)href\s*=\s*"([^"]*)"/i;

/**
 * Rewrites anchors to verified URLs and strips the ones that cannot be verified.
 *
 * Runs on HTML rather than Markdown because by then every link is already a
 * structured anchor node — matching Markdown again would risk re-processing
 * text the author typed by hand.
 */
export function resolveLinks(html: string, index: LinkIndex): LinkResolution {
  const resolved: { anchor: string; url: string }[] = [];
  const unresolved: { anchor: string; href: string }[] = [];

  const out = html.replace(ANCHOR, (whole, attrs: string, anchorHtml: string) => {
    const href = HREF.exec(attrs)?.[1] ?? "";
    if (href === "") return whole;

    // External links are the author's own and are left exactly as written.
    if (/^https?:\/\//i.test(href)) {
      const sameSite = index.all.some((t) => t.url === href);
      if (!sameSite) return whole;
    }

    const anchorText = anchorHtml.replace(/<[^>]+>/g, "").trim();
    const target = resolveTarget(index, href, anchorText);

    if (target === null) {
      unresolved.push({ anchor: anchorText, href });
      // Keep the words, drop the link. A reader loses nothing; a broken link
      // costs trust and a 404.
      return anchorHtml;
    }

    /*
     * Rewritten clean, which is the point: a link to one of the author's own
     * posts should carry no `nofollow` and no `target`, and the editor stamps
     * both onto every anchor it renders. An internal link marked nofollow is
     * the site declining to pass its own equity around.
     */
    resolved.push({ anchor: anchorText, url: target.url });
    return `<a href="${target.url}">${anchorHtml}</a>`;
  });

  return { html: out, resolved, unresolved };
}
