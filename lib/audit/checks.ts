import type { CrawledPage, Issue, IssueSeverity } from "@/lib/audit/types";

/**
 * Issue checks.
 *
 * To add a new check: append one entry to CHECKS. Nothing else changes —
 * scoring, filtering, counts and the UI all read from this list.
 */

export type CheckContext = {
  /** Titles seen more than once across the crawl. */
  duplicateTitles: Set<string>;
  duplicateDescriptions: Set<string>;
  minWordCount: number;
};

type Check = {
  severity: IssueSeverity;
  run: (page: CrawledPage, ctx: CheckContext) => string | null;
};

/**
 * Whether we actually read this page's HTML.
 *
 * Content checks are only meaningful when there was content. `status < 400`
 * looked like that test and was not: a request that never completed is
 * recorded as status 0, which passes `< 400`, so a page the crawler could not
 * reach was reported as having no title and no H1. A page the host refused to
 * serve (403/429) has no HTML either.
 */
function analysed(p: CrawledPage): boolean {
  return p.outcome.state === "valid" || p.outcome.state === "redirect";
}

/**
 * Content images genuinely missing alt text, counted only where the crawl
 * recorded which image.
 *
 * The count and the evidence are written together by lib/audit/images.ts, so
 * for any current crawl this is just `imagesMissingAlt`. It differs on rows
 * written BEFORE that classifier existed, which counted every `img` without an
 * alt attribute — decorative markup, lazy-load placeholders and theme chrome
 * alike — and recorded no source, because there was nothing to record. Those
 * rows are why pages the owner had verified by hand kept being reported: the
 * archive page at /vegan-recipes stored 30 missing, and the same page read
 * through the current classifier has 5 content images and none missing.
 *
 * An unsourced count is also unusable in its own right. It cannot be shown
 * (there is no image to name), it cannot be fixed (the fix action needs a src)
 * and it cannot be verified. So the issue requires its evidence, which keeps
 * the card summary, the detail list and the fix action reading the same fact.
 */
function missingAltCount(p: CrawledPage): number {
  return p.imagesMissingAltSrc.length === 0 ? 0 : p.imagesMissingAlt;
}

const CHECKS: Record<string, Check> = {
  /*
   * A real HTTP failure. Cloudflare answers this crawler with 429 on the
   * client's site, and `status >= 400` made every rate-limited page a
   * high-severity error: 59 of 100 pages in the last audit, which is why not
   * one page came back clean. Only a destination that genuinely failed counts.
   */
  http_error: {
    severity: "high",
    run: (p) =>
      p.outcome.state === "broken" ? `Returned HTTP ${String(p.status)}` : null,
  },

  /** The crawler could not read the page. Says nothing about the page. */
  page_unreachable: {
    severity: "low",
    run: (p) =>
      p.outcome.state === "blocked" || p.outcome.state === "timeout"
        ? p.outcome.detail
        : null,
  },

  missing_title: {
    severity: "high",
    run: (p) => (analysed(p) && p.title.trim() === "" ? "No title tag" : null),
  },

  missing_h1: {
    severity: "medium",
    run: (p) => (analysed(p) && p.h1.length === 0 ? "No H1 heading" : null),
  },

  multiple_h1: {
    severity: "low",
    run: (p) =>
      p.h1.length > 1 ? `${String(p.h1.length)} H1 tags on the page` : null,
  },

  missing_meta_description: {
    severity: "medium",
    run: (p) =>
      analysed(p) && p.metaDescription.trim() === ""
        ? "No meta description"
        : null,
  },

  title_too_long: {
    severity: "low",
    run: (p) =>
      analysed(p) && p.title.length > 60
        ? `${String(p.title.length)} characters — Google typically truncates after ~60`
        : null,
  },

  meta_too_long: {
    severity: "low",
    run: (p) =>
      analysed(p) && p.metaDescription.length > 160
        ? `${String(p.metaDescription.length)} characters — snippet may be cut off`
        : null,
  },

  short_content: {
    severity: "medium",
    run: (p, ctx) =>
      analysed(p) && p.wordCount > 0 && p.wordCount < ctx.minWordCount
        ? `Only ${String(p.wordCount)} words`
        : null,
  },

  duplicate_title: {
    severity: "medium",
    run: (p, ctx) =>
      p.title.trim() !== "" && ctx.duplicateTitles.has(p.title.trim())
        ? "Title is used on another page"
        : null,
  },

  duplicate_meta_description: {
    severity: "low",
    run: (p, ctx) =>
      p.metaDescription.trim() !== "" &&
      ctx.duplicateDescriptions.has(p.metaDescription.trim())
        ? "Meta description is used on another page"
        : null,
  },

  /*
   * Counts content images only. An image marked decorative (`alt=""`,
   * `role="presentation"`, aria-hidden) is correct markup, not a defect, and
   * site chrome is not this page's content — both are excluded upstream in
   * lib/audit/images.ts.
   */
  missing_alt: {
    severity: "low",
    run: (p) => {
      const missing = missingAltCount(p);
      return missing > 0
        ? `${String(missing)} of ${String(p.imagesTotal)} content image${p.imagesTotal === 1 ? "" : "s"} missing alt text`
        : null;
    },
  },

  /** Informational: shows the author their decorative markup was understood. */
  decorative_image: {
    severity: "low",
    run: (p) =>
      p.imagesDecorative > 0 && missingAltCount(p) === 0
        ? `${String(p.imagesDecorative)} decorative image${p.imagesDecorative === 1 ? "" : "s"} correctly marked — no alt needed`
        : null,
  },

  broken_internal_link: {
    severity: "high",
    run: (p) =>
      p.brokenLinks.length > 0
        ? `${String(p.brokenLinks.length)} broken internal link${p.brokenLinks.length === 1 ? "" : "s"}`
        : null,
  },

  /*
   * A link the host refused to serve the crawler is not a broken link. It is
   * reported so nothing is hidden, but at low severity and with wording that
   * does not tell the author to fix a link that works.
   */
  blocked_internal_link: {
    severity: "low",
    run: (p) =>
      p.blockedLinks.length > 0
        ? `${String(p.blockedLinks.length)} link${p.blockedLinks.length === 1 ? "" : "s"} could not be checked (host blocked or timed out) — not broken`
        : null,
  },

  not_indexable: {
    severity: "medium",
    run: (p) =>
      analysed(p) && !p.indexable ? "Blocked by a noindex directive" : null,
  },
};

export function runChecks(page: CrawledPage, ctx: CheckContext): Issue[] {
  const issues: Issue[] = [];

  for (const [code, check] of Object.entries(CHECKS)) {
    const detail = check.run(page, ctx);
    if (detail !== null) {
      issues.push({
        code: code as Issue["code"],
        severity: check.severity,
        detail,
      });
    }
  }

  return issues;
}
