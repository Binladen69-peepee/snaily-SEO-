"use client";

import { FileDown } from "lucide-react";
import { toast } from "sonner";

import { downloadCsv, toCsv } from "@/lib/keywords/csv";
import { opportunityScore } from "@/lib/keywords/opportunity";
import type { Keyword } from "@/lib/keywords/types";

/**
 * Downloads the analysed keyword — plus its related terms and questions —
 * as CSV, matching the "Export CSV" action on KeySearch's analysis card.
 */
export function ExportCsvButton({
  keyword,
  related = [],
  country,
}: {
  keyword: Keyword;
  related?: Keyword[];
  country: string;
}) {
  function download() {
    const rows = [keyword, ...related].map((k) => ({
      ...k,
      opportunity: opportunityScore(k),
    }));
    downloadCsv(
      `${keyword.keyword.replace(/\s+/g, "-")}-${country}.csv`,
      toCsv(rows),
    );
    toast.success(`Exported ${String(rows.length)} keywords`);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-card px-3 text-[12.5px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FileDown className="size-3.5" aria-hidden />
      Export CSV
    </button>
  );
}
