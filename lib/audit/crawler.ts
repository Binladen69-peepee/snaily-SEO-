import * as cheerio from "cheerio";

import type { CrawledPage } from "@/lib/audit/types";

export const CRAWL_DEFAULTS = {
  maxPages: 100,
  concurrency: 4,
  timeoutMs: 12_000,
  politenessMs: 200,
  userAgent: "SEOToolBot/1.0 (+content audit)",
};

/**
 * Blocks private / loopback / link-local hosts so a crawl can't hit internal
 * services. Set ALLOW_PRIVATE_CRAWL=1 to audit a local site on a self-hosted
 * install where you control every project.
 */
function isPrivateHost(hostname: string): boolean {
  if (process.env.ALLOW_PRIVATE_CRAWL === "1") return false;

  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

/** Strips the fragment and trailing slash so the same page isn't crawled twice. */
function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = u.search; // keep query — it can produce distinct pages
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

const SKIP_EXT =
  /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|json|xml|pdf|zip|mp4|mp3|woff2?|ttf|eot)(\?|$)/i;

async function fetchRobots(origin: string, signal: AbortSignal) {
  const disallow: string[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal,
      headers: { "User-Agent": CRAWL_DEFAULTS.userAgent },
    });
    if (!res.ok) return disallow;

    const text = await res.text();
    let applies = false;
    for (const line of text.split(/\r?\n/)) {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey?.trim().toLowerCase() ?? "";
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*";
      else if (applies && key === "disallow" && value !== "") {
        disallow.push(value);
      }
    }
  } catch {
    // No robots.txt is fine — crawl everything.
  }
  return disallow;
}

function isAllowed(pathname: string, disallow: string[]): boolean {
  return !disallow.some((rule) => pathname.startsWith(rule));
}

type FetchedPage = Omit<CrawledPage, "issues" | "brokenLinks">;

/** Fetches and parses one HTML page — used by the site audit and On-Page Analyzer. */
export async function fetchSinglePage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CRAWL_DEFAULTS.timeoutMs);
  try {
    return await fetchPage(url, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(
  url: string,
  signal: AbortSignal,
): Promise<FetchedPage> {
  const empty: FetchedPage = {
    url,
    status: 0,
    title: "",
    metaDescription: "",
    h1: [],
    wordCount: 0,
    canonical: "",
    indexable: true,
    lastModified: null,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    internalLinks: [],
  };

  let res: Response;
  try {
    res = await fetch(url, {
      signal,
      redirect: "follow",
      headers: { "User-Agent": CRAWL_DEFAULTS.userAgent },
    });
  } catch {
    return { ...empty, status: 0 };
  }

  const contentType = res.headers.get("content-type") ?? "";
  const lastModified = res.headers.get("last-modified");

  if (!res.ok || !contentType.includes("text/html")) {
    return { ...empty, status: res.status, lastModified };
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  $("script, style, noscript, svg").remove();

  const h1 = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t !== "");

  const robotsMeta = ($("meta[name='robots']").attr("content") ?? "").toLowerCase();
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const images = $("img");
  const missingAlt = images.filter((_, el) => {
    const alt = $(el).attr("alt");
    return alt === undefined || alt.trim() === "";
  }).length;

  const base = new URL(res.url);
  const internalLinks = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href === undefined || href.startsWith("#")) return;
    if (/^(mailto|tel|javascript):/i.test(href)) return;

    try {
      const target = new URL(href, base);
      if (target.hostname !== base.hostname) return;
      if (SKIP_EXT.test(target.pathname)) return;
      internalLinks.add(normalize(target.toString()));
    } catch {
      // Ignore malformed hrefs.
    }
  });

  return {
    url: normalize(res.url),
    status: res.status,
    title: ($("title").first().text() || "").trim(),
    metaDescription: ($("meta[name='description']").attr("content") ?? "").trim(),
    h1,
    wordCount: text === "" ? 0 : text.split(" ").length,
    canonical: ($("link[rel='canonical']").attr("href") ?? "").trim(),
    indexable: !robotsMeta.includes("noindex"),
    lastModified,
    imagesTotal: images.length,
    imagesMissingAlt: missingAlt,
    internalLinks: [...internalLinks],
  };
}

export type CrawlOptions = {
  startUrl: string;
  maxPages?: number;
  onProgress?: (crawled: number, found: number) => void | Promise<void>;
};

export type CrawlOutcome = {
  pages: FetchedPage[];
  /** URLs that returned 4xx/5xx, used to flag broken internal links. */
  brokenUrls: Set<string>;
  /**
   * Distinct internal URLs seen, including any the page cap stopped us
   * fetching. Always >= pages.length.
   */
  discovered: number;
};

/**
 * Breadth-first crawl of a single host.
 *
 * Deliberately simple: one process, bounded page count, small concurrency,
 * politeness delay, robots.txt honoured. Good enough for the sites this tool
 * targets and easy to reason about.
 */
export async function crawlSite(options: CrawlOptions): Promise<CrawlOutcome> {
  const maxPages = Math.min(options.maxPages ?? CRAWL_DEFAULTS.maxPages, 500);

  const start = new URL(options.startUrl);
  if (isPrivateHost(start.hostname)) {
    throw new Error("This host cannot be crawled.");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000, // hard stop after 10 minutes
  );

  try {
    const disallow = await fetchRobots(start.origin, controller.signal);

    const queue: string[] = [normalize(start.toString())];
    const seen = new Set<string>(queue);
    const pages: FetchedPage[] = [];

    while (queue.length > 0 && pages.length < maxPages) {
      const batch = queue.splice(0, CRAWL_DEFAULTS.concurrency);

      const results = await Promise.all(
        batch.map(async (url) => {
          const pageTimer = setTimeout(() => {
            controller.abort();
          }, CRAWL_DEFAULTS.timeoutMs);
          try {
            return await fetchPage(url, controller.signal);
          } finally {
            clearTimeout(pageTimer);
          }
        }),
      );

      for (const page of results) {
        if (pages.length >= maxPages) break;
        pages.push(page);

        for (const link of page.internalLinks) {
          if (seen.has(link) || seen.size >= maxPages * 3) continue;
          try {
            if (!isAllowed(new URL(link).pathname, disallow)) continue;
          } catch {
            continue;
          }
          seen.add(link);
          queue.push(link);
        }
      }

      await options.onProgress?.(pages.length, seen.size);
      await new Promise((r) => setTimeout(r, CRAWL_DEFAULTS.politenessMs));
    }

    // Any crawled URL with a bad status is a broken target for links pointing at it.
    const brokenUrls = new Set(
      pages.filter((p) => p.status === 0 || p.status >= 400).map((p) => p.url),
    );

    return { pages, brokenUrls, discovered: seen.size };
  } finally {
    clearTimeout(timer);
  }
}
