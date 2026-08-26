export type IssueSeverity = "high" | "medium" | "low";

export type IssueCode =
  | "missing_title"
  | "missing_meta_description"
  | "title_too_long"
  | "meta_too_long"
  | "missing_h1"
  | "multiple_h1"
  | "short_content"
  | "duplicate_title"
  | "duplicate_meta_description"
  | "missing_alt"
  | "broken_internal_link"
  | "blocked_internal_link"
  | "decorative_image"
  | "not_indexable"
  | "http_error"
  | "page_unreachable";

export type Issue = {
  code: IssueCode;
  severity: IssueSeverity;
  /** Short, page-specific explanation, e.g. "3 images missing alt text". */
  detail: string;
};

import type { LinkOutcome } from "@/lib/audit/link-status";

export type CrawledPage = {
  url: string;
  status: number;
  title: string;
  metaDescription: string;
  h1: string[];
  wordCount: number;
  canonical: string;
  indexable: boolean;
  lastModified: string | null;
  /** Content images only — chrome and decorative images are excluded. */
  imagesTotal: number;
  /** Content images with no alt attribute at all. */
  imagesMissingAlt: number;
  /** Images correctly marked decorative. Reported, never a defect. */
  imagesDecorative: number;
  /** Images belonging to site furniture rather than this page's content. */
  imagesChrome: number;
  internalLinks: string[];
  brokenLinks: string[];
  /** Links the host refused to serve the crawler, or that timed out. */
  blockedLinks: string[];
  /** How this page's own request resolved. */
  outcome: LinkOutcome;
  issues: Issue[];
};

export type AuditStatus = "running" | "completed" | "failed";

export const ISSUE_LABEL: Record<IssueCode, string> = {
  missing_title: "Missing title",
  missing_meta_description: "Missing meta description",
  title_too_long: "Title too long",
  meta_too_long: "Meta description too long",
  missing_h1: "Missing H1",
  multiple_h1: "Multiple H1 tags",
  short_content: "Short content",
  duplicate_title: "Duplicate title",
  duplicate_meta_description: "Duplicate meta description",
  missing_alt: "Missing image alt text",
  broken_internal_link: "Broken internal link",
  blocked_internal_link: "Link could not be checked",
  decorative_image: "Decorative images (no alt needed)",
  not_indexable: "Not indexable",
  http_error: "HTTP error",
  page_unreachable: "Could not be crawled",
};

/**
 * Issues that are not defects.
 *
 * Each of these tells the author something true and asks nothing of them: an
 * image correctly marked decorative, or a page the crawler could not reach.
 * Counting them as problems made every page on the client's site "unclean"
 * and dragged the health score down for markup that was already right.
 *
 * They still appear in the issue list; they just do not make a page dirty.
 */
export const INFORMATIONAL_ISSUES: ReadonlySet<IssueCode> = new Set([
  "decorative_image",
  "blocked_internal_link",
  "page_unreachable",
]);

/** True when this issue asks the author to change something. */
export function isDefect(code: IssueCode): boolean {
  return !INFORMATIONAL_ISSUES.has(code);
}

export const SEVERITY_WEIGHT: Record<IssueSeverity, number> = {
  high: 5,
  medium: 2,
  low: 1,
};
