import * as cheerio from "cheerio";

/**
 * Referring domains and anchor text, measured rather than modelled.
 *
 * The Explorer's "Top DS Referring Domains" and "Top Anchors" panels were
 * empty because both were wired to a Common Crawl webgraph lookup that needs a
 * paid key. But we already know a set of real pages that reference the domain
 * — Google returns them for `"domain" -site:domain` — and a page's outbound
 * anchors are readable by anyone who fetches it.
 *
 * So this fetches those citing pages and reads what they actually say:
 *
 *  - which domains link out to the target, and how many times
 *  - the literal text inside each of those anchors
 *
 * That is measurement, not estimation. The one honest caveat, which the UI
 * repeats: this sees only the citing pages Google chose to return, so it is a
 * real sample of the link profile rather than the whole of it.
 */

const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = "SEOToolBot/1.0 (+link citation reader)";

/** Bounded so one lookup cannot spend a minute fetching strangers' pages. */
const MAX_PAGES = 10;
const CONCURRENCY = 4;

export type AnchorCount = {
  text: string;
  count: number;
};

export type CitingDomain = {
  domain: string;
  /** Links to the target found across this domain's citing pages. */
  links: number;
  /** Citing pages seen on this domain. */
  hosts: number;
  authority: number | null;
};

export type CitationProfile = {
  /** Domains that link out to the target, strongest first. */
  domains: CitingDomain[];
  /** Anchor text actually used, most frequent first. */
  anchors: AnchorCount[];
  /** Citing pages fetched successfully. */
  pagesRead: number;
  /** Citing pages Google returned, whether or not they could be fetched. */
  pagesFound: number;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** True when `href` points at the target domain or one of its subdomains. */
function pointsAt(href: string, target: string): boolean {
  const host = hostOf(href);
  return host === target || host.endsWith(`.${target}`);
}

/**
 * Anchor text, tidied without being rewritten.
 *
 * Whitespace is collapsed and the string is capped, but the words are the
 * author's. An image link with no text reports "[image]" rather than being
 * dropped, because a bare image link is a real and different thing.
 */
function anchorText(raw: string, hasImage: boolean): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text !== "") return text.slice(0, 80);
  return hasImage ? "[image]" : "";
}

async function readCitingPage(
  url: string,
  target: string,
): Promise<{ domain: string; anchors: string[] } | null> {
  const domain = hostOf(url);
  if (domain === "" || domain === target) return null;

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) return null;

    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;

    const $ = cheerio.load(await res.text());
    const anchors: string[] = [];

    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      // Relative hrefs cannot point off-site, so they are never a citation.
      if (!/^https?:\/\//i.test(href)) return;
      if (!pointsAt(href, target)) return;
      const text = anchorText($(el).text(), $(el).find("img").length > 0);
      if (text !== "") anchors.push(text);
    });

    return { domain, anchors };
  } catch {
    // A page that blocks bots, times out or 404s is simply not counted.
    return null;
  }
}

/** Runs `work` over `items` with a fixed number in flight. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        out.push(await work(items[i]!));
      }
    },
  );
  await Promise.all(runners);
  return out;
}

/**
 * Reads the citing pages and reports who links, and with what words.
 *
 * `authorityFor` is injected so this module never reaches into the metrics
 * cache itself — the caller already has the scores it needs.
 */
export async function readCitations(
  target: string,
  citingUrls: string[],
  authorityFor: (domain: string) => number | null,
): Promise<CitationProfile> {
  const urls = [...new Set(citingUrls)].slice(0, MAX_PAGES);

  const results = (
    await pooled(urls, CONCURRENCY, (url) => readCitingPage(url, target))
  ).filter((r): r is { domain: string; anchors: string[] } => r !== null);

  const byDomain = new Map<string, { links: number; hosts: number }>();
  const byAnchor = new Map<string, number>();

  for (const page of results) {
    const entry = byDomain.get(page.domain) ?? { links: 0, hosts: 0 };
    entry.hosts += 1;
    entry.links += page.anchors.length;
    byDomain.set(page.domain, entry);

    for (const text of page.anchors) {
      // Case-folded for counting so "Blog With Ben" and "blog with ben" are
      // one anchor, but the first spelling seen is what gets displayed.
      const key = text.toLowerCase();
      byAnchor.set(key, (byAnchor.get(key) ?? 0) + 1);
    }
  }

  const seenSpelling = new Map<string, string>();
  for (const page of results) {
    for (const text of page.anchors) {
      const key = text.toLowerCase();
      if (!seenSpelling.has(key)) seenSpelling.set(key, text);
    }
  }

  const domains: CitingDomain[] = [...byDomain.entries()]
    .map(([domain, v]) => ({
      domain,
      links: v.links,
      hosts: v.hosts,
      authority: authorityFor(domain),
    }))
    .sort(
      (a, b) => (b.authority ?? -1) - (a.authority ?? -1) || b.links - a.links,
    );

  const anchors: AnchorCount[] = [...byAnchor.entries()]
    .map(([key, count]) => ({ text: seenSpelling.get(key) ?? key, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, 12);

  return {
    domains,
    anchors,
    pagesRead: results.length,
    pagesFound: citingUrls.length,
  };
}
