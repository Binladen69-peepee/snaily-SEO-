import type { Issue } from "@/lib/audit/types";
import type { PagePerformance } from "@/lib/google/performance";

/** The subset of a stored AuditPage that Content Intelligence reasons about. */
export type PageSnapshot = {
  url: string;
  path: string;
  status: number;
  title: string;
  wordCount: number;
  internalLinkCount: number;
  brokenLinks: string[];
  lastModified: string | null;
  issues: Issue[];
};

/** One line of a score's explanation. Every score is a sum of these. */
export type ScoreReason = {
  label: string;
  /** Page-specific extra context, e.g. "3 broken internal links". */
  detail?: string;
  points: number;
};

export type Score = {
  score: number;
  reasons: ScoreReason[];
};

export type DecayCode =
  | "content_shrank"
  | "issues_increased"
  | "links_lost"
  | "stale";

export type DecaySignal = {
  code: DecayCode;
  label: string;
  detail: string;
};

export type PageIntel = PageSnapshot & {
  priority: Score;
  opportunity: Score;
  /** 0–100. 100 means no issues found on this page. */
  health: number;
  decay: DecaySignal[];
  /** Issue codes present now that were absent in the previous audit. */
  newIssues: Issue[];
  /** Issue codes fixed since the previous audit. */
  resolvedIssues: Issue[];
  /** Absent from the previous audit entirely. */
  isNew: boolean;
  /** Live Search Console / GA4 figures for this URL, when connected. */
  performance: PagePerformance | null;
};

export type IssueDelta = {
  path: string;
  url: string;
  code: Issue["code"];
  detail: string;
};

export type Comparison = {
  previousId: string;
  previousDate: string;
  healthDelta: number;
  issueDelta: number;
  pagesDelta: number;
  newIssueCount: number;
  resolvedIssueCount: number;
  /** Capped for display — use the counts above for totals. */
  newIssues: IssueDelta[];
  resolvedIssues: IssueDelta[];
  newPages: { path: string; url: string }[];
  removedPages: { path: string; url: string }[];
  /** Pages whose issue set changed in either direction. */
  changedPages: number;
};

export type IntelSummary = {
  /** True when Google data was available for this report. */
  hasPerformance: boolean;
  totalPages: number;
  needsAttention: number;
  cleanPages: number;
  decayingPages: number;
  avgPriority: number;
  quickWins: number;
};

export type IntelReport = {
  auditId: string;
  auditDate: string;
  healthScore: number;
  summary: IntelSummary;
  comparison: Comparison | null;
  pages: PageIntel[];
};

export const PRIORITY_BANDS = [
  { min: 70, label: "Critical", variant: "destructive" as const },
  { min: 40, label: "High", variant: "warning" as const },
  { min: 15, label: "Medium", variant: "secondary" as const },
  { min: 1, label: "Low", variant: "outline" as const },
  { min: 0, label: "None", variant: "success" as const },
];

export function priorityBand(score: number) {
  return PRIORITY_BANDS.find((b) => score >= b.min) ?? PRIORITY_BANDS[4];
}
