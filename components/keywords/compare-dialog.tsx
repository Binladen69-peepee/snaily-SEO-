"use client";

import type { Row } from "@/components/keywords/bulk-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  difficultyBand,
  formatCpc,
  formatNumber,
  INTENT_LABEL,
  INTENT_VARIANT,
} from "@/lib/keywords/format";
import { opportunityBand } from "@/lib/keywords/opportunity";

/** Tiny inline sparkline so trends can be compared at a glance. */
function Sparkline({ trend }: { trend: number[] }) {
  const max = Math.max(...trend, 1);
  return (
    <span className="flex h-8 items-end gap-px" aria-hidden>
      {trend.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-sm bg-primary/60"
          style={{ height: `${String(Math.max(8, (v / max) * 100))}%` }}
        />
      ))}
    </span>
  );
}

/** Highlights the winner in each row so the comparison has a takeaway. */
function best(values: number[], mode: "high" | "low"): number {
  return mode === "high" ? Math.max(...values) : Math.min(...values);
}

export function CompareDialog({
  open,
  onOpenChange,
  keywords,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keywords: Row[];
}) {
  if (keywords.length === 0) return null;

  const bestVolume = best(keywords.map((k) => k.volume), "high");
  const bestDifficulty = best(keywords.map((k) => k.difficulty), "low");
  const bestOpportunity = best(keywords.map((k) => k.opportunity), "high");

  const win = "font-semibold text-success";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare keywords</DialogTitle>
          <DialogDescription>
            {keywords.length} keywords side by side. Green marks the best value
            in each row.
          </DialogDescription>
        </DialogHeader>

        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Keyword metric comparison</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 text-left font-medium">
                  Metric
                </th>
                {keywords.map((k) => (
                  <th
                    key={k.keyword}
                    scope="col"
                    className="max-w-[12rem] px-3 py-2 text-left font-medium"
                  >
                    <span className="block truncate" title={k.keyword}>
                      {k.keyword}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              <tr className="border-b border-border">
                <th scope="row" className="py-2 text-left text-muted-foreground">
                  Volume
                </th>
                {keywords.map((k) => (
                  <td
                    key={k.keyword}
                    className={`tabular px-3 py-2 ${k.volume === bestVolume ? win : ""}`}
                  >
                    {formatNumber(k.volume)}
                  </td>
                ))}
              </tr>

              <tr className="border-b border-border">
                <th scope="row" className="py-2 text-left text-muted-foreground">
                  Difficulty
                </th>
                {keywords.map((k) => (
                  <td
                    key={k.keyword}
                    className={`tabular px-3 py-2 ${k.difficulty === bestDifficulty ? win : ""}`}
                  >
                    {k.difficulty}{" "}
                    <span className="text-xs text-muted-foreground">
                      {difficultyBand(k.difficulty).label}
                    </span>
                  </td>
                ))}
              </tr>

              <tr className="border-b border-border">
                <th scope="row" className="py-2 text-left text-muted-foreground">
                  CPC
                </th>
                {keywords.map((k) => (
                  <td key={k.keyword} className="tabular px-3 py-2">
                    {formatCpc(k.cpc)}
                  </td>
                ))}
              </tr>

              <tr className="border-b border-border">
                <th scope="row" className="py-2 text-left text-muted-foreground">
                  Paid competition
                </th>
                {keywords.map((k) => (
                  <td key={k.keyword} className="tabular px-3 py-2">
                    {k.competition.toFixed(2)}
                  </td>
                ))}
              </tr>

              <tr className="border-b border-border">
                <th scope="row" className="py-2 text-left text-muted-foreground">
                  Intent
                </th>
                {keywords.map((k) => (
                  <td key={k.keyword} className="px-3 py-2">
                    <Badge variant={INTENT_VARIANT[k.intent]}>
                      {INTENT_LABEL[k.intent]}
                    </Badge>
                  </td>
                ))}
              </tr>

              <tr className="border-b border-border">
                <th scope="row" className="py-2 text-left text-muted-foreground">
                  Opportunity
                </th>
                {keywords.map((k) => (
                  <td
                    key={k.keyword}
                    className={`tabular px-3 py-2 ${k.opportunity === bestOpportunity ? win : ""}`}
                  >
                    {k.opportunity}{" "}
                    <span className="text-xs text-muted-foreground">
                      {opportunityBand(k.opportunity).label}
                    </span>
                  </td>
                ))}
              </tr>

              <tr>
                <th scope="row" className="py-2 text-left text-muted-foreground">
                  12-month trend
                </th>
                {keywords.map((k) => (
                  <td key={k.keyword} className="px-3 py-2">
                    <Sparkline trend={k.trend} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
