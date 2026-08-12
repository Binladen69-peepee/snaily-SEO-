import type { Keyword } from "@/lib/keywords/types";

function escapeCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = [
  "Keyword",
  "Volume",
  "Difficulty",
  "CPC",
  "Competition",
  "Intent",
  "Opportunity",
] as const;

export function toCsv(rows: (Keyword & { opportunity: number })[]): string {
  const lines = [HEADERS.join(",")];

  for (const r of rows) {
    lines.push(
      [
        escapeCell(r.keyword),
        r.volume,
        r.difficulty,
        r.cpc.toFixed(2),
        r.competition.toFixed(2),
        r.intent,
        r.opportunity,
      ].join(","),
    );
  }

  return lines.join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob([`﻿${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Pulls keywords out of a pasted TXT or CSV file (first column). */
export function extractKeywordsFromFile(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const first = line.split(",")[0] ?? "";
      return first.replace(/^"|"$/g, "").trim();
    })
    .filter((k) => k !== "")
    .join("\n");
}
