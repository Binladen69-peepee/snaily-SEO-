import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { buildLinkIndex, normaliseSlug } from "@/lib/content/link-index";
import { isValidId, prisma } from "@/lib/db";

/**
 * Link support for the editor.
 *
 * Suggestions come from the two sets of links the author actually uses, and
 * from nowhere else:
 *
 *   - **Site pages**, from `WpPost` — posts and pages really synced from
 *     WordPress, so a suggestion always resolves.
 *   - **Ingredient and product links**, from `AffiliateLink` — the author's own
 *     spreadsheet, with the affiliate URL exactly as they wrote it.
 *
 * Nothing is invented. A URL this endpoint has never seen is reported as
 * unverified rather than guessed at, because a plausible-looking invented link
 * costs a 404 on the published post.
 *
 *   GET  ?q=ginger   → suggestions to link to
 *   POST { hrefs }   → verdict per link, for the audit panel
 */

type Params = { params: Promise<{ id: string }> };

export type LinkSuggestion = {
  title: string;
  url: string;
  slug: string;
  /** "post"/"page" for site content; the sheet's category for a product. */
  type: string;
  kind: "internal" | "affiliate";
  /** Affiliate links are marked up as sponsored when inserted. */
  rel?: string;
  target?: string;
};

async function projectFor(id: string, userId: string): Promise<string | null> {
  if (!isValidId(id)) return null;
  const article = await prisma.article.findFirst({
    where: { id, userId },
    select: { projectId: true },
  });
  return article?.projectId ?? null;
}

export async function GET(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const projectId = await projectFor(id, session.userId);
  if (projectId === null) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const query = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() ?? "";

  const [index, affiliates] = await Promise.all([
    buildLinkIndex(projectId),
    prisma.affiliateLink.findMany({
      where: { projectId, enabled: true },
      select: { term: true, url: true, kind: true, category: true },
    }),
  ]);

  if (query === "") {
    return NextResponse.json({
      suggestions: [],
      total: index.all.length,
      products: affiliates.length,
    });
  }

  const words = query.split(/\s+/).filter((w) => w.length > 1);

  /** Same shape of score for both sets, so one ranking can order them. */
  function score(haystack: string, terms: string[], slug: string): number {
    const text = haystack.toLowerCase();
    let n = 0;
    // A title that starts with what was typed is almost always the one meant.
    if (text.startsWith(query)) n += 100;
    else if (text.includes(query)) n += 60;
    n += words.filter((w) => terms.includes(w)).length * 10;
    if (slug !== "" && slug.includes(query.replace(/\s+/g, "-"))) n += 20;
    return n;
  }

  const pages: { s: LinkSuggestion; score: number }[] = index.all
    .map((target) => ({
      s: {
        title: target.title,
        url: target.url,
        slug: target.slug,
        type: target.type,
        kind: "internal" as const,
      },
      score: score(target.title, target.terms, target.slug),
    }))
    .filter((r) => r.score > 0);

  const products: { s: LinkSuggestion; score: number }[] = affiliates
    .map((row) => ({
      s: {
        title: row.term,
        url: row.url,
        slug: "",
        type: row.category,
        kind: "affiliate" as const,
        /*
         * An affiliate link without rel="sponsored" is a manual-action risk, so
         * the markup is decided here rather than left to whoever inserts it.
         * Sheet rows pointing at the author's own site are ordinary internal
         * links and keep their equity.
         */
        ...(row.kind === "affiliate"
          ? { rel: "sponsored nofollow", target: "_blank" }
          : {}),
      },
      score: score(row.term, row.term.split(/\s+/), ""),
    }))
    .filter((r) => r.score > 0);

  const byScore = (a: { s: LinkSuggestion; score: number }, b: typeof a) =>
    b.score - a.score || a.s.title.length - b.s.title.length;

  return NextResponse.json({
    total: index.all.length,
    products: affiliates.length,
    suggestions: [
      ...pages.sort(byScore).slice(0, 8),
      ...products.sort(byScore).slice(0, 6),
    ].map((r) => r.s),
  });
}

export type LinkVerdict = {
  href: string;
  anchor: string;
  kind: "internal" | "external" | "anchor" | "mailto";
  /** Only meaningful for internal links. */
  status: "verified" | "unverified" | "not-checked";
  /** The real page this resolves to, when it resolves. */
  title?: string;
};

export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const projectId = await projectFor(id, session.userId);
  if (projectId === null) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = (body as { links?: unknown }).links;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "Expected { links: [] }" }, { status: 400 });
  }

  const links = raw
    .filter(
      (l): l is { href: string; anchor: string } =>
        l !== null &&
        typeof l === "object" &&
        typeof (l as { href?: unknown }).href === "string",
    )
    .slice(0, 300)
    .map((l) => ({
      href: l.href,
      anchor: typeof l.anchor === "string" ? l.anchor : "",
    }));

  const index = await buildLinkIndex(projectId);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { url: true },
  });

  const site = (() => {
    try {
      return new URL(project?.url ?? "").hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  })();

  const verdicts: LinkVerdict[] = links.map(({ href, anchor }) => {
    if (href.startsWith("#")) {
      return { href, anchor, kind: "anchor", status: "not-checked" };
    }
    if (/^mailto:/i.test(href)) {
      return { href, anchor, kind: "mailto", status: "not-checked" };
    }

    const isAbsolute = /^https?:\/\//i.test(href);
    const host = isAbsolute
      ? (() => {
          try {
            return new URL(href).hostname.replace(/^www\./, "").toLowerCase();
          } catch {
            return "";
          }
        })()
      : "";

    const internal = !isAbsolute || (site !== "" && host === site);
    if (!internal) {
      /*
       * External links are not fetched. Checking them would mean the server
       * issuing arbitrary outbound requests on behalf of whatever a draft
       * contains, and a 403 from a site that blocks bots would be reported as
       * a dead link when it is fine in a browser.
       */
      return { href, anchor, kind: "external", status: "not-checked" };
    }

    const slug = normaliseSlug(href);
    const target = index.bySlug.get(slug);
    return target
      ? { href, anchor, kind: "internal", status: "verified", title: target.title }
      : { href, anchor, kind: "internal", status: "unverified" };
  });

  return NextResponse.json({ verdicts, indexed: index.all.length });
}
