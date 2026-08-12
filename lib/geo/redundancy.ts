/**
 * What the blog has already published.
 *
 * The spec is blunt about why this exists: the generator must never suggest an
 * article that duplicates something already live, and must never produce two
 * ideas that differ only by a place name. Both checks run against this index
 * before any idea is shown.
 *
 * Read-only, and tolerant — a site with no WordPress REST API falls back to the
 * sitemap, and a site with neither simply gets no redundancy checking rather
 * than a failed run.
 */

const TIMEOUT_MS = 12_000;
const USER_AGENT = "SnailySEO/1.0 (+geo lab redundancy index)";

export type ExistingPost = { title: string; url: string };

async function get(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** WordPress exposes posts at /wp-json/wp/v2/posts on most installs. */
async function fromWordPress(origin: string): Promise<ExistingPost[]> {
  const out: ExistingPost[] = [];

  for (const page of [1, 2]) {
    const res = await get(
      `${origin}/wp-json/wp/v2/posts?per_page=100&page=${String(page)}&_fields=link,title`,
    );
    if (!res) break;

    const rows = (await res.json().catch(() => [])) as {
      link?: string;
      title?: { rendered?: string };
    }[];
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const r of rows) {
      const title = (r.title?.rendered ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
        .replace(/&amp;/g, "&")
        .trim();
      if (title !== "" && r.link) out.push({ title, url: r.link });
    }

    if (rows.length < 100) break;
  }

  return out;
}

/** Sitemap fallback: titles are inferred from the slug, which is enough to compare. */
async function fromSitemap(origin: string): Promise<ExistingPost[]> {
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
  ];

  for (const candidate of candidates) {
    const res = await get(candidate);
    if (!res) continue;

    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());

    // An index file points at more sitemaps; follow the first couple.
    const nested = locs.filter((l) => l.endsWith(".xml"));
    const pages = locs.filter((l) => !l.endsWith(".xml"));

    if (pages.length > 0) {
      return pages.slice(0, 300).map((url) => ({ url, title: titleFromUrl(url) }));
    }

    for (const child of nested.slice(0, 3)) {
      const sub = await get(child);
      if (!sub) continue;
      const subXml = await sub.text();
      const subLocs = [...subXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((m) => m[1]!.trim())
        .filter((l) => !l.endsWith(".xml"));
      if (subLocs.length > 0) {
        return subLocs.slice(0, 300).map((url) => ({ url, title: titleFromUrl(url) }));
      }
    }
  }

  return [];
}

function titleFromUrl(url: string): string {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return slug.replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

export async function fetchExistingPosts(siteUrl: string): Promise<ExistingPost[]> {
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return [];
  }

  const wp = await fromWordPress(origin);
  if (wp.length > 0) return wp;
  return fromSitemap(origin);
}

/* -------------------------------------------------------------------------
 * Similarity
 * ---------------------------------------------------------------------- */

const FILLER = new Set([
  "a","an","the","and","or","for","to","of","in","on","at","with","your","you",
  "is","are","how","what","why","when","where","which","do","does","can","should",
  "my","it","its","that","this","from","by","vs","versus","best","guide",
]);

/** Place names are stripped before comparing, so city-swaps collapse together. */
const PLACE_HINTS =
  /\b(nj|ny|pa|new jersey|new york|pennsylvania|nyc|philadelphia|philly|hoboken|jersey city|brooklyn|manhattan|bucks county|montclair|princeton|asbury park|north jersey|south jersey)\b/gi;

function shingle(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(PLACE_HINTS, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !FILLER.has(w)),
  );
}

/** Jaccard overlap of the meaningful words, ignoring place names. */
export function similarity(a: string, b: string): number {
  const sa = shingle(a);
  const sb = shingle(b);
  if (sa.size === 0 || sb.size === 0) return 0;

  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;

  return shared / (sa.size + sb.size - shared);
}

/** Above this two titles are treated as the same article. */
export const REDUNDANT_AT = 0.6;

/**
 * Flags a title against already-published posts and against ideas already
 * accepted in this run — the spec requires both directions.
 */
export function findDuplicate(
  title: string,
  published: ExistingPost[],
  siblings: string[],
): string | null {
  for (const p of published) {
    if (similarity(title, p.title) >= REDUNDANT_AT) {
      return `Already published: ${p.title}`;
    }
  }
  for (const s of siblings) {
    if (similarity(title, s) >= REDUNDANT_AT) {
      return `Too close to another idea in this set: ${s}`;
    }
  }
  return null;
}
