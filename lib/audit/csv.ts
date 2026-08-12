import type { Issue } from "@/lib/audit/types";
import { ISSUE_LABEL } from "@/lib/audit/types";

type AuditExportRow = {
  path: string;
  url: string;
  status: number;
  title: string;
  wordCount: number;
  issues: Issue[];
};

function escapeCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function auditPagesToCsv(rows: AuditExportRow[]): string {
  const headers = [
    "Path",
    "URL",
    "Status",
    "Title",
    "Word count",
    "Issue count",
    "Issues",
  ];

  const lines = [headers.join(",")];

  for (const row of rows) {
    const issueText = row.issues
      .map((i) => `${ISSUE_LABEL[i.code]} (${i.severity}): ${i.detail}`)
      .join(" | ");

    lines.push(
      [
        escapeCell(row.path),
        escapeCell(row.url),
        row.status === 0 ? "ERR" : row.status,
        escapeCell(row.title),
        row.wordCount,
        row.issues.length,
        escapeCell(issueText),
      ].join(","),
    );
  }

  return lines.join("\n");
}
