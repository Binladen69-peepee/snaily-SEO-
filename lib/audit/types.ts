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
  | "not_indexable"
  | "http_error";

export type Issue = {
  code: IssueCode;
  severity: IssueSeverity;
  /** Short, page-specific explanation, e.g. "3 images missing alt text". */
  detail: string;
};

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
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinks: string[];
  brokenLinks: string[];
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
  not_indexable: "Not indexable",
  http_error: "HTTP error",
};

export const SEVERITY_WEIGHT: Record<IssueSeverity, number> = {
  high: 5,
  medium: 2,
  low: 1,
};
