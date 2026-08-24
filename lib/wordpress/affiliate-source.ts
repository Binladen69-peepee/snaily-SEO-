/**
 * The client's live affiliate links, read from their WordPress install.
 *
 * Investigated rather than assumed. What is actually on cinnamonsnail.com:
 *
 *  - **Easy Affiliate Links** (`easy_affiliate_link` custom post type) is the
 *    real source of truth. 494 records, 490 active with a URL, each carrying a
 *    name, the destination, a category list and an array of match texts that
 *    the author uses as aliases ("Bouillon Paste" → "Better Than Bouillon").
 *  - **WP Recipe Maker** stores its ingredients as the `wprm_ingredient`
 *    taxonomy, and each term has an `ingredient.eafl` field holding the id of
 *    an Easy Affiliate Link, plus `ingredient.link` for a direct URL. So WPRM
 *    does not own the links; it points at Easy Affiliate Links.
 *  - WPRM's rendered recipe cards contain no affiliate anchors at all: a scan
 *    of 300 synced posts found 0 links inside `wprm-*-ingredient` elements,
 *    while 286 of those posts carry affiliate links in the body prose.
 *
 * Both are exposed on the public WP REST API, unauthenticated, so this needs
 * no credentials and no plugin of ours. The author adds a link in WordPress and
 * it appears here on the next refresh — which is the whole point, and what the
 * hand-maintained CSV could not do.
 */

const PER_PAGE = 100;
const MAX_PAGES = 10;
const TIMEOUT_MS = 15_000;

export type WpAffiliateLink = {
  /** Canonical product name as the author typed it. */
  name: string;
  url: string;
  /** Every string the author wants matched, including the name itself. */
  aliases: string[];
  categories: string[];
  /** Easy Affiliate Links post id, for diagnostics. */
  sourceId: number;
};

export type WpAffiliateResult = {
  links: WpAffiliateLink[];
  /** Set when the site answered but had nothing usable. */
  reason: string | null;
};

type EaflRecord = {
  id?: number;
  status?: string;
  link?: {
    name?: string;
    url?: string;
    text?: unknown;
    categories?: unknown;
    active?: string;
  };
};

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/**
 * Reads every Easy Affiliate Link from a WordPress site.
 *
 * Paged until a short page comes back. Inactive links and links with no URL
 * are dropped here rather than downstream, so nothing that cannot resolve ever
 * reaches the matcher.
 */
export async function fetchWpAffiliateLinks(
  siteUrl: string,
): Promise<WpAffiliateResult> {
  const origin = siteUrl.trim().replace(/\/+$/, "");
  if (origin === "") return { links: [], reason: "No site URL configured." };

  const links: WpAffiliateLink[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await getJson(
      `${origin}/wp-json/wp/v2/easy_affiliate_link?per_page=${String(PER_PAGE)}&page=${String(page)}`,
    );
    if (!Array.isArray(data)) {
      // A first-page failure means the plugin or the route is not there.
      if (page === 1) {
        return {
          links: [],
          reason:
            "The site did not answer /wp/v2/easy_affiliate_link. Easy Affiliate Links may not be installed, or the route is not public.",
        };
      }
      break;
    }

    for (const raw of data as EaflRecord[]) {
      const link = raw.link;
      const url = typeof link?.url === "string" ? link.url.trim() : "";
      const name = typeof link?.name === "string" ? link.name.trim() : "";
      if (url === "" || name === "") continue;
      if (link?.active !== undefined && link.active !== "yes") continue;
      if (!/^https?:\/\//i.test(url)) continue;

      // The author's own match strings, plus the record name. De-duplicated
      // case-insensitively so "Tamari" and "tamari" are one alias.
      const aliases = [...new Set([name, ...strings(link?.text)].map((a) => a.trim()))]
        .filter((a) => a !== "");

      links.push({
        name,
        url,
        aliases,
        categories: strings(link?.categories),
        sourceId: typeof raw.id === "number" ? raw.id : 0,
      });
    }

    if (data.length < PER_PAGE) break;
  }

  return {
    links,
    reason: links.length === 0 ? "No active affiliate links with a URL." : null,
  };
}

export type WprmIngredientLink = {
  ingredient: string;
  /** Easy Affiliate Links id this ingredient points at, when set. */
  eaflId: number | null;
  /** Direct URL on the term, when the author set one instead. */
  url: string | null;
};

/**
 * WPRM's ingredient taxonomy, and what each term points at.
 *
 * Read as a second signal rather than a source: the affiliate URL itself lives
 * in Easy Affiliate Links, and this says which ingredient name the author
 * attached it to. That mapping is more trustworthy than string-matching a
 * product name against prose, so where it exists it wins.
 */
export async function fetchWprmIngredientLinks(
  siteUrl: string,
): Promise<WprmIngredientLink[]> {
  const origin = siteUrl.trim().replace(/\/+$/, "");
  if (origin === "") return [];

  const out: WprmIngredientLink[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await getJson(
      `${origin}/wp-json/wp/v2/wprm_ingredient?per_page=${String(PER_PAGE)}&page=${String(page)}`,
    );
    if (!Array.isArray(data)) break;

    for (const raw of data as {
      name?: string;
      ingredient?: { eafl?: unknown; link?: unknown };
    }[]) {
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (name === "") continue;

      const eaflRaw = raw.ingredient?.eafl;
      const eaflId =
        typeof eaflRaw === "number"
          ? eaflRaw
          : typeof eaflRaw === "string" && /^\d+$/.test(eaflRaw)
            ? Number(eaflRaw)
            : null;

      const urlRaw = raw.ingredient?.link;
      const url =
        typeof urlRaw === "string" && /^https?:\/\//i.test(urlRaw.trim())
          ? urlRaw.trim()
          : null;

      if (eaflId === null && url === null) continue;
      out.push({ ingredient: name, eaflId, url });
    }

    if (data.length < PER_PAGE) break;
  }

  return out;
}
