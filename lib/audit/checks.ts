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

const CHECKS: Record<string, Check> = {
  http_error: {
    severity: "high",
    run: (p) => (p.status >= 400 ? `Returned HTTP ${String(p.status)}` : null),
  },

  missing_title: {
    severity: "high",
    run: (p) => (p.status < 400 && p.title.trim() === "" ? "No title tag" : null),
  },

  missing_h1: {
    severity: "medium",
    run: (p) => (p.status < 400 && p.h1.length === 0 ? "No H1 heading" : null),
  },

  multiple_h1: {
    severity: "low",
    run: (p) =>
      p.h1.length > 1 ? `${String(p.h1.length)} H1 tags on the page` : null,
  },

  missing_meta_description: {
    severity: "medium",
    run: (p) =>
      p.status < 400 && p.metaDescription.trim() === ""
        ? "No meta description"
        : null,
  },

  title_too_long: {
    severity: "low",
    run: (p) =>
      p.status < 400 && p.title.length > 60
        ? `${String(p.title.length)} characters — Google typically truncates after ~60`
        : null,
  },

  meta_too_long: {
    severity: "low",
    run: (p) =>
      p.status < 400 && p.metaDescription.length > 160
        ? `${String(p.metaDescription.length)} characters — snippet may be cut off`
        : null,
  },

  short_content: {
    severity: "medium",
    run: (p, ctx) =>
      p.status < 400 && p.wordCount > 0 && p.wordCount < ctx.minWordCount
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

  missing_alt: {
    severity: "low",
    run: (p) =>
      p.imagesMissingAlt > 0
        ? `${String(p.imagesMissingAlt)} of ${String(p.imagesTotal)} images missing alt text`
        : null,
  },

  broken_internal_link: {
    severity: "high",
    run: (p) =>
      p.brokenLinks.length > 0
        ? `${String(p.brokenLinks.length)} broken internal link${p.brokenLinks.length === 1 ? "" : "s"}`
        : null,
  },

  not_indexable: {
    severity: "medium",
    run: (p) =>
      p.status < 400 && !p.indexable ? "Blocked by a noindex directive" : null,
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
