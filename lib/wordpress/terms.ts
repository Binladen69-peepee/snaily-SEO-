/**
 * The site's category archives, with their real permalinks.
 *
 * The "why you'll adore this recipe" section links to a group of recipes
 * rather than to one of them — "like all of my vegan Thai recipes" — and the
 * page that group lives on is a category archive. Only posts and pages were
 * ever synced, so no archive had a verified URL, and the rule this codebase
 * runs on is that a URL is never invented. The result was that a whole class
 * of link the client asked for could not be written at all.
 *
 * Read from WordPress's own REST API rather than through the connector plugin.
 * `/wp-json/wp/v2/categories` is public on every WordPress install, so this
 * needs no plugin update on the client's site — the same reasoning that WPRM's
 * ingredient taxonomy is read directly.
 */

import { prisma } from "@/lib/db";

const PER_PAGE = 100;
const MAX_PAGES = 10;

/** Archives with almost nothing in them are not worth sending a reader to. */
const MIN_POSTS = 3;

/**
 * A tag has to be in real use before the export will file a post under it.
 *
 * Lower than the category floor on purpose: a site's tags are narrower by
 * nature. On The Cinnamon Snail it makes no practical difference — the site
 * has one tag, used once — which is itself the answer to "populate tags where
 * applicable": here, it is not.
 */
const MIN_TAG_POSTS = 2;

export type RemoteTerm = {
  wpId: number;
  name: string;
  slug: string;
  link: string;
  count: number;
};

type RawTerm = {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  link?: unknown;
  count?: unknown;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as unknown;
}

/**
 * Every category on the site, in one or more pages.
 *
 * Names arrive HTML-encoded from WordPress ("Gluten&#8211;free"), which is
 * fine for display and wrong for matching a name written in prose, so the
 * common entities are decoded here.
 */
export async function fetchTerms(
  siteUrl: string,
  taxonomy: "category" | "post_tag",
): Promise<RemoteTerm[]> {
  const origin = siteUrl.trim().replace(/\/+$/, "");
  if (origin === "") return [];

  const route = taxonomy === "category" ? "categories" : "tags";
  const out: RemoteTerm[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await getJson(
      `${origin}/wp-json/wp/v2/${route}?per_page=${String(PER_PAGE)}&page=${String(page)}&_fields=id,name,slug,link,count`,
    );
    if (!Array.isArray(data)) break;

    for (const raw of data as RawTerm[]) {
      const wpId = typeof raw.id === "number" ? raw.id : 0;
      const link = str(raw.link);
      const name = decodeEntities(str(raw.name));
      // No permalink means nothing to link to, which is the whole point.
      if (wpId <= 0 || link === "" || name === "") continue;

      out.push({
        wpId,
        name,
        slug: str(raw.slug),
        link,
        count: typeof raw.count === "number" ? raw.count : 0,
      });
    }

    if (data.length < PER_PAGE) break;
  }

  return out;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#038;": "&",
  "&#8211;": "-",
  "&#8212;": "-",
  "&#8217;": "'",
  "&#039;": "'",
  "&quot;": '"',
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|#038|#8211|#8212|#8217|#039|quot|nbsp);/g, (m) =>
    ENTITIES[m] ?? m,
  );
}

/** Kept for callers that only want the category archives. */
export async function fetchCategories(siteUrl: string): Promise<RemoteTerm[]> {
  return fetchTerms(siteUrl, "category");
}

export type TermSyncResult = { imported: number; skipped: number };

/**
 * Refreshes the stored category list for a project.
 *
 * Never fatal. A site that has disabled the public REST API, or a network
 * hiccup, costs the post its category links and nothing else — which is why
 * the caller treats a rejection here as a warning rather than a failed sync.
 */
export async function syncCategories(
  projectId: string,
  siteUrl: string,
): Promise<TermSyncResult> {
  let imported = 0;
  let skipped = 0;

  for (const taxonomy of ["category", "post_tag"] as const) {
    const floor = taxonomy === "category" ? MIN_POSTS : MIN_TAG_POSTS;
    const terms = await fetchTerms(siteUrl, taxonomy);

    for (const term of terms) {
      if (term.count < floor) {
        skipped += 1;
        continue;
      }

      const fields = {
        name: term.name,
        slug: term.slug,
        link: term.link,
        count: term.count,
      };

      await prisma.wpTerm.upsert({
        where: { projectId_taxonomy_wpId: { projectId, taxonomy, wpId: term.wpId } },
        create: { projectId, taxonomy, wpId: term.wpId, ...fields },
        update: fields,
      });
      imported += 1;
    }
  }

  return { imported, skipped };
}
