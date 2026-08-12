/**
 * Finds real, freely-licensed images for generated articles.
 *
 * The model is never asked to write image URLs. It cannot know which ones
 * exist, so it invents plausible-looking links that 404 — worse than no image
 * at all. Instead it marks *where* an image belongs and describes it, and the
 * marker is resolved here against Wikimedia Commons: free, no API key, and
 * everything returned is licensed for reuse.
 *
 * Nothing unverified reaches the editor. If a search finds nothing the marker
 * is dropped rather than leaving a broken frame in the article.
 */

const ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const TIMEOUT_MS = 12_000;
const MIN_WIDTH = 800;

/** Wikimedia asks callers to identify themselves. */
const USER_AGENT = "SnailySEO/1.0 (self-hosted SEO tool; contact via site owner)";

export type FoundImage = {
  url: string;
  alt: string;
  /** Commons file page, for attribution. */
  source: string;
};

type CommonsResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: {
          url?: string;
          thumburl?: string;
          descriptionurl?: string;
          mime?: string;
          width?: number;
        }[];
      }
    >;
  };
};

/** Within one generation the same subject is often requested twice. */
const cache = new Map<string, FoundImage | null>();

export async function findImage(query: string): Promise<FoundImage | null> {
  const term = query.trim().toLowerCase();
  if (term === "") return null;

  const cached = cache.get(term);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    // `filetype:bitmap` keeps out PDFs, SVG diagrams and video stills, which
    // otherwise dominate the results and look wrong in an article.
    gsrsearch: `${term} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "6",
    prop: "imageinfo",
    iiprop: "url|mime|size",
    iiurlwidth: "1200",
    format: "json",
  });

  let payload: CommonsResponse;
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      cache.set(term, null);
      return null;
    }
    payload = (await res.json()) as CommonsResponse;
  } catch {
    cache.set(term, null);
    return null;
  }

  const candidates = Object.values(payload.query?.pages ?? {})
    .map((p) => ({ title: p.title ?? "", info: p.imageinfo?.[0] }))
    .filter(
      (c) =>
        c.info !== undefined &&
        /^image\/(jpeg|png|webp)$/.test(c.info.mime ?? "") &&
        (c.info.width ?? 0) >= MIN_WIDTH,
    );

  const best = candidates[0];
  if (!best?.info) {
    cache.set(term, null);
    return null;
  }

  const url = best.info.thumburl ?? best.info.url;
  if (url === undefined || !url.startsWith("https://")) {
    cache.set(term, null);
    return null;
  }

  const found: FoundImage = {
    url,
    // "File:Tomato cucumber salad.jpg" → "Tomato cucumber salad"
    alt: best.title.replace(/^File:/, "").replace(/\.\w+$/, "").replace(/_/g, " "),
    source: best.info.descriptionurl ?? url,
  };

  cache.set(term, found);
  return found;
}

/** Matches the marker the model is told to emit: `[[image: a cucumber salad]]`. */
const MARKER = /\[\[image:\s*([^\]]{2,120})\]\]/gi;

/**
 * Swaps image markers in generated Markdown for real images.
 *
 * Markers that resolve become a standalone Markdown image, which the editor
 * renders as a block-level picture. Markers that do not resolve are removed
 * entirely — a generated article should never contain a placeholder or a
 * broken image.
 */
export async function resolveImageMarkers(markdown: string): Promise<string> {
  const queries = [...markdown.matchAll(MARKER)].map((m) => m[1]!.trim());
  if (queries.length === 0) return markdown;

  // Cap the work: a handful of images is plenty for one section, and each is
  // an outbound request on a request-scoped budget.
  const unique = [...new Set(queries.map((q) => q.toLowerCase()))].slice(0, 4);
  const found = new Map<string, FoundImage | null>();

  await Promise.all(
    unique.map(async (q) => {
      found.set(q, await findImage(q));
    }),
  );

  return markdown
    .replace(MARKER, (_match, raw: string) => {
      const image = found.get(raw.trim().toLowerCase());
      if (!image) return "";
      const alt = raw.trim().replace(/[[\]()]/g, "");
      return `![${alt}](${image.url})`;
    })
    // Collapse the blank lines a removed marker leaves behind.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
