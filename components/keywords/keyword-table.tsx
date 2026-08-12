"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ScorePill } from "@/components/difficulty";
import type { Row } from "@/components/keywords/bulk-table";
import { useKeywordToolbar } from "@/components/keywords/toolbar";
import { formatCpc, formatNumber } from "@/lib/keywords/format";
import { opportunityScore } from "@/lib/keywords/opportunity";
import type { Keyword } from "@/lib/keywords/types";
import { cn } from "@/lib/utils";

type SortKey = "keyword" | "volume" | "cpc" | "competition" | "difficulty";

const COLUMNS: {
  key: SortKey;
  label: string;
  title: string;
  align: "left" | "right";
}[] = [
  { key: "volume", label: "Volume", title: "Average monthly searches", align: "right" },
  { key: "cpc", label: "CPC", title: "Average cost per click", align: "right" },
  { key: "competition", label: "PPC", title: "Paid competition, 0–1", align: "right" },
  { key: "difficulty", label: "Score", title: "Keyword difficulty, 0–100", align: "right" },
];

/**
 * The keyword idea list in KeySearch's right-hand panel.
 *
 * Selection lives in the toolbar context rather than here, because the Save /
 * Compare / Export buttons that act on it sit up in the search strip.
 */
export function KeywordTable({
  keywords,
  country,
  total,
  projectId,
}: {
  keywords: Keyword[];
  country: string;
  total: number;
  projectId: string | null;
}) {
  const { selected, setSelected, publish } = useKeywordToolbar();
  const [sort, setSort] = useState<SortKey>("volume");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const rows: Row[] = useMemo(
    () => keywords.map((k) => ({ ...k, opportunity: opportunityScore(k) })),
    [keywords],
  );

  // Hand the server-rendered rows to the toolbar so its buttons can act on them.
  useEffect(() => {
    publish(rows, country, projectId);
  }, [rows, country, projectId, publish]);

  const sorted = useMemo(() => {
    const factor = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) =>
      sort === "keyword"
        ? a.keyword.localeCompare(b.keyword) * factor
        : (a[sort] - b[sort]) * factor,
    );
  }, [rows, sort, dir]);

  const allSelected =
    sorted.length > 0 && sorted.every((r) => selected.has(r.keyword));

  function toggleSort(key: SortKey) {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "keyword" ? "asc" : "desc");
    }
  }

  function toggleOne(keyword: string) {
    const next = new Set(selected);
    if (next.has(keyword)) next.delete(keyword);
    else next.add(keyword);
    setSelected(next);
  }

  function toggleAll() {
    const next = new Set(selected);
    for (const r of sorted) {
      if (allSelected) next.delete(r.keyword);
      else next.add(r.keyword);
    }
    setSelected(next);
  }

  const arrow = (key: SortKey) =>
    sort === key ? (dir === "asc" ? " ↑" : " ↓") : "";

  return (
    <table className="w-full min-w-[30rem] text-[12.5px]">
      <caption className="sr-only">
        Keyword ideas with volume, cost per click and difficulty
      </caption>

      {/* Sticky only where the panel is its own scroll container. */}
      <thead className="bg-card xl:sticky xl:top-0 xl:z-10">
        <tr className="border-b border-border text-muted-foreground">
          <th scope="col" className="w-8 py-2 pl-3 pr-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label="Select all keywords"
              className="size-3.5 cursor-pointer accent-primary"
            />
          </th>

          <th scope="col" className="py-2 pr-2 text-left font-normal">
            <button
              type="button"
              onClick={() => {
                toggleSort("keyword");
              }}
              className="hover:text-foreground"
            >
              Keyword <span className="tabular">({formatNumber(total)})</span>
              {arrow("keyword")}
            </button>
          </th>

          {COLUMNS.map((c) => (
            <th
              key={c.key}
              scope="col"
              title={c.title}
              aria-sort={
                sort === c.key
                  ? dir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
              className={cn(
                "py-2 pr-3 font-normal",
                c.align === "right" ? "text-right" : "text-left",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  toggleSort(c.key);
                }}
                className={
                  sort === c.key ? "text-foreground" : "hover:text-foreground"
                }
              >
                {c.label}
                {arrow(c.key)}
              </button>
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {sorted.map((k) => (
          <tr
            key={k.keyword}
            className="border-b border-border/70 hover:bg-accent/50"
          >
            <td className="py-1.5 pl-3 pr-1">
              <input
                type="checkbox"
                checked={selected.has(k.keyword)}
                onChange={() => {
                  toggleOne(k.keyword);
                }}
                aria-label={`Select ${k.keyword}`}
                className="size-3.5 cursor-pointer accent-primary"
              />
            </td>

            <td className="max-w-[18rem] py-1.5 pr-2">
              <Link
                href={`/keywords?q=${encodeURIComponent(k.keyword)}&country=${country}`}
                className="block truncate hover:text-primary hover:underline"
                title={k.keyword}
              >
                {k.keyword}
              </Link>
            </td>

            <td className="tabular py-1.5 pr-3 text-right">
              {formatNumber(k.volume)}
            </td>
            <td className="tabular py-1.5 pr-3 text-right">
              {formatCpc(k.cpc).replace("$", "")}
            </td>
            <td className="tabular py-1.5 pr-3 text-right">
              {k.competition.toFixed(2)}
            </td>
            <td className="py-1.5 pr-3 text-right">
              {k.difficulty > 0 ? (
                <ScorePill score={k.difficulty} />
              ) : (
                <Link
                  href={`/keywords/difficulty?q=${encodeURIComponent(k.keyword)}&country=${country}`}
                  aria-label={`Check difficulty for ${k.keyword}`}
                  className="inline-flex text-muted-foreground hover:text-primary"
                >
                  <Search className="size-3.5" />
                </Link>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
