import * as cheerio from "cheerio";

import { auditImages } from "@/lib/audit/images";
import {
  classifyFailure,
  classifyResponse,
  shouldRetry,
  type LinkOutcome,
} from "@/lib/audit/link-status";
import type { CrawledPage } from "@/lib/audit/types";

export const CRAWL_DEFAULTS = {
  maxPages: 100,
  concurrency: 4,
  timeoutMs: 12_000,
  politenessMs: 200,
  userAgent: "SEOToolBot/1.0 (+content audit)",
  /*
   * Cloudflare answers the bot agent above with 429 on some hosts
   * (cinnamonsnail.com among them), which the audit used to record as a broken
   * page. The retry presents the same agent string a reader's browser would,
   * so a block is confirmed as a real failure before anything is reported.
   */
  retryUserAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  /** Pause before a retry when the host gave no Retry-After. */
  backoffMs: 2_500,
  maxBackoffMs: 15_000,
  /** Politeness ceiling once a host has started rate limiting us. */
  maxPolitenessMs: 2_000,
};

/** Sleep that gives up when the crawl is aborted. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Retry-After, which is either seconds or an HTTP date. */
function retryAfterMs(header: string | null): number {
  if (header === null) return 0;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(header);
  return Number.isNaN(when) ? 0 : Math.max(0, when - Date.now());
}

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

type FetchedPage = Omit<
  CrawledPage,
  "issues" | "brokenLinks" | "blockedLinks"
>;

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
  onBlocked?: () => void,
): Promise<FetchedPage> {
  const empty: FetchedPage = {
    url,
    status: 0,
    outcome: {
      state: "timeout",
      status: 0,
      finalUrl: url,
      redirected: false,
      detail: "Not fetched",
    },
    title: "",
    metaDescription: "",
    h1: [],
    wordCount: 0,
    canonical: "",
    indexable: true,
    lastModified: null,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    imagesDecorative: 0,
    imagesChrome: 0,
    internalLinks: [],
  };

  /*
   * Two attempts at most: the first as the audit bot, and — only when the host
   * blocked us or the request timed out — one more presenting a browser agent.
   * A link is never reported on the strength of a single refused request.
   */
  const attempt = async (userAgent: string): Promise<Response | LinkOutcome> => {
    try {
      return await fetch(url, {
        signal,
        redirect: "follow",
        headers: { "User-Agent": userAgent },
      });
    } catch (err) {
      return classifyFailure(url, err);
    }
  };

  let res = await attempt(CRAWL_DEFAULTS.userAgent);

  let outcome: LinkOutcome =
    res instanceof Response
      ? classifyResponse(url, res.status, res.url)
      : res;

  if (shouldRetry(outcome) && !signal.aborted) {
    /*
     * Wait before trying again.
     *
     * Cloudflare's 429 on the client's site is a rate limit, so retrying
     * immediately with a different user agent just collects a second 429 —
     * measured at 17 of 40 pages still blocked. Honour Retry-After when the
     * host sends one, otherwise back off far enough to leave the window.
     */
    const retryAfter =
      res instanceof Response ? retryAfterMs(res.headers.get("retry-after")) : 0;
    const wait = Math.min(
      CRAWL_DEFAULTS.maxBackoffMs,
      retryAfter > 0 ? retryAfter : CRAWL_DEFAULTS.backoffMs,
    );
    await sleep(wait, signal);
    onBlocked?.();

    const retried = signal.aborted
      ? null
      : await attempt(CRAWL_DEFAULTS.retryUserAgent);

    if (retried !== null) {
      const retryOutcome =
        retried instanceof Response
          ? classifyResponse(url, retried.status, retried.url)
          : retried;
      // Keep the better of the two: a retry that succeeded settles it.
      if (retryOutcome.state === "valid" || retryOutcome.state === "redirect") {
        res = retried;
      }
      outcome = retryOutcome;
    }
  }

  if (!(res instanceof Response)) {
    return { ...empty, status: outcome.status, outcome };
  }

  const contentType = res.headers.get("content-type") ?? "";
  const lastModified = res.headers.get("last-modified");

  if (!res.ok || !contentType.includes("text/html")) {
    return { ...empty, status: res.status, lastModified, outcome };
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

  const imageAudit = auditImages($);

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
    imagesTotal: imageAudit.total,
    imagesMissingAlt: imageAudit.missingAlt,
    imagesDecorative: imageAudit.decorative,
    imagesChrome: imageAudit.chrome,
    internalLinks: [...internalLinks],
    outcome,
  };
}

export type CrawlOptions = {
  startUrl: string;
  maxPages?: number;
  onProgress?: (crawled: number, found: number) => void | Promise<void>;
};

export type CrawlOutcome = {
  pages: FetchedPage[];
  /** URLs genuinely gone (404/410/5xx after retry). */
  brokenUrls: Set<string>;
  /** URLs the host refused to serve us, or that timed out. Not broken. */
  blockedUrls: Set<string>;
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

    /** How many times a host has refused us; widens the politeness gap. */
    let blocks = 0;

    const queue: string[] = [normalize(start.toString())];
    const seen = new Set<string>(queue);
    const pages: FetchedPage[] = [];

    while (queue.length > 0 && pages.length < maxPages) {
      const batch = queue.splice(0, CRAWL_DEFAULTS.concurrency);

      const results = await Promise.all(
        batch.map(async (url) => {
          /*
           * This timeout used to abort `controller` — the crawl-wide signal.
           * One page slower than 12s therefore aborted every request that came
           * after it, each of which was recorded with status 0 and reported as
           * a broken link. The signal is per page now, linked to the crawl
           * signal only so a global stop still propagates.
           */
          const pageController = new AbortController();
          const onAbort = () => {
            pageController.abort();
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });
          const pageTimer = setTimeout(() => {
            pageController.abort();
          }, CRAWL_DEFAULTS.timeoutMs);
          try {
            return await fetchPage(url, pageController.signal, () => {
              blocks += 1;
            });
          } finally {
            clearTimeout(pageTimer);
            controller.signal.removeEventListener("abort", onAbort);
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

      /*
       * Slow down when the host starts refusing us.
       *
       * A fixed 200ms gap is polite to a quiet server and far too fast for one
       * behind a rate limiter: the client's site refused 17 of 40 pages at that
       * pace. Each block widens the gap, so a crawl that starts hitting limits
       * finishes slower but complete, rather than fast and full of holes.
       */
      const politeness = Math.min(
        CRAWL_DEFAULTS.maxPolitenessMs,
        CRAWL_DEFAULTS.politenessMs * (1 + blocks),
      );
      await sleep(politeness, controller.signal);
    }

    /*
     * Only a destination that genuinely is not there counts against the site.
     * A page the host refused to serve the crawler (403/429), or one that timed
     * out, says nothing about whether a reader can open the link — those are
     * reported separately so the author can see them without being told their
     * working links are broken.
     */
    const brokenUrls = new Set(
      pages.filter((p) => p.outcome.state === "broken").map((p) => p.url),
    );
    const blockedUrls = new Set(
      pages
        .filter((p) => p.outcome.state === "blocked" || p.outcome.state === "timeout")
        .map((p) => p.url),
    );

    return { pages, brokenUrls, blockedUrls, discovered: seen.size };
  } finally {
    clearTimeout(timer);
  }
}
