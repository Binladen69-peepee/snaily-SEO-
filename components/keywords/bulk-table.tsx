"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import Link from "next/link";

import { MetricSourceMark } from "@/components/keywords/metric-source";
import { Badge } from "@/components/ui/badge";
import {
  difficultyBand,
  formatCpc,
  formatVolume,
  INTENT_LABEL,
  INTENT_VARIANT,
} from "@/lib/keywords/format";
import { opportunityBand } from "@/lib/keywords/opportunity";
import type { Keyword } from "@/lib/keywords/types";

export type Row = Keyword & { opportunity: number };
export type SortKey =
  | "keyword"
  | "volume"
  | "difficulty"
  | "cpc"
  | "competition"
  | "intent"
  | "opportunity";
export type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "keyword", label: "Keyword", align: "left" },
  { key: "volume", label: "Volume", align: "right" },
  { key: "difficulty", label: "Difficulty", align: "right" },
  { key: "cpc", label: "CPC", align: "right" },
  { key: "competition", label: "Competition", align: "right" },
  { key: "intent", label: "Intent", align: "left" },
  { key: "opportunity", label: "Opportunity", align: "right" },
];

export function sortRows(rows: Row[], key: SortKey, dir: SortDir): Row[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * factor;
    }
    return ((av as number) - (bv as number)) * factor;
  });
}

type Props = {
  rows: Row[];
  country: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  selected: Set<string>;
  onToggle: (keyword: string) => void;
  onToggleAll: () => void;
};

export function BulkTable({
  rows,
  country,
  sortKey,
  sortDir,
  onSort,
  selected,
  onToggle,
  onToggleAll,
}: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.keyword));

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Bulk keyword analysis results, sortable by any column
        </caption>
        <thead className="bg-muted/50">
          <tr>
            <th scope="col" className="w-10 px-3 py-2.5">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all keywords"
                className="size-4 cursor-pointer accent-primary"
              />
            </th>

            {COLUMNS.map((col) => {
              const active = sortKey === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    active
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={`px-3 py-2.5 font-medium ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSort(col.key);
                    }}
                    className={`inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active ? "text-foreground" : "text-muted-foreground"
                    } ${col.align === "right" ? "flex-row-reverse" : ""}`}
                  >
                    {col.label}
                    {active ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3 opacity-40" />
                    )}
                  </button>
                </th>
              );
            })}

            <th scope="col" className="w-10 px-3 py-2.5">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => {
            const kd = difficultyBand(r.difficulty);
            const opp = opportunityBand(r.opportunity);
            const isSelected = selected.has(r.keyword);

            return (
              <tr
                key={r.keyword}
                className={`border-t border-border transition-colors ${
                  isSelected ? "bg-primary/5" : "hover:bg-accent/40"
                }`}
              >
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {
                      onToggle(r.keyword);
                    }}
                    aria-label={`Select ${r.keyword}`}
                    className="size-4 cursor-pointer accent-primary"
                  />
                </td>

                <td className="max-w-xs px-3 py-2.5">
                  <span className="block truncate font-medium">{r.keyword}</span>
                </td>

                <td className="tabular px-3 py-2.5 text-right">
                  {formatVolume(r.volume)}
                  <MetricSourceMark source={r.metricsSource} />
                </td>

                <td className={`tabular px-3 py-2.5 text-right ${kd.className}`}>
                  {r.difficulty}
                </td>

                <td className="tabular px-3 py-2.5 text-right">
                  {formatCpc(r.cpc)}
                </td>

                <td className="tabular px-3 py-2.5 text-right">
                  {r.competition.toFixed(2)}
                </td>

                <td className="px-3 py-2.5">
                  <Badge variant={INTENT_VARIANT[r.intent]}>
                    {INTENT_LABEL[r.intent]}
                  </Badge>
                </td>

                <td className={`tabular px-3 py-2.5 text-right font-semibold ${opp.className}`}>
                  {r.opportunity}
                </td>

                <td className="px-3 py-2.5">
                  <Link
                    href={`/keywords/${encodeURIComponent(r.keyword)}?country=${country}`}
                    aria-label={`View details for ${r.keyword}`}
                    className="inline-flex rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ExternalLink className="size-3.5" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
