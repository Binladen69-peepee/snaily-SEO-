"use client";

import { Crosshair, Download, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ScorePill } from "@/components/difficulty";
import { Input } from "@/components/ui/input";
import { downloadCsv } from "@/lib/keywords/csv";
import { estimateTraffic } from "@/lib/keywords/ctr";
import { formatCpc, formatNumber, formatVolume } from "@/lib/keywords/format";
import type { OrganicKeyword } from "@/lib/competitors";
import { cn } from "@/lib/utils";

type SortKey =
  | "keyword"
  | "position"
  | "estTraffic"
  | "clicks"
  | "impressions"
  | "volume"
  | "cpc"
  | "difficulty";

const COLUMNS: {
  key: SortKey;
  label: string;
  title: string;
  align: "left" | "right";
  /** Only shown when Search Console supplied the row. */
  measuredOnly?: boolean;
}[] = [
  { key: "keyword", label: "Keyword", title: "Keyword phrase", align: "left" },
  { key: "position", label: "Position", title: "Measured ranking position", align: "right" },
  { key: "estTraffic", label: "Est. traffic", title: "Monthly visits implied by position and volume", align: "right" },
  { key: "clicks", label: "Clicks", title: "Clicks in the last 28 days", align: "right", measuredOnly: true },
  { key: "impressions", label: "Impr.", title: "Impressions in the last 28 days", align: "right", measuredOnly: true },
  { key: "volume", label: "Volume", title: "Estimated monthly searches", align: "right" },
  { key: "cpc", label: "CPC", title: "Estimated cost per click", align: "right" },
  { key: "difficulty", label: "KD", title: "Estimated keyword difficulty, 0–100", align: "right" },
];

/** Unranked rows sort last whichever direction is chosen. */
function compare(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

/** How many keywords one "check positions" click will look up. */
const CHECK_BATCH = 10;

export function OrganicTable({
  keywords: initial,
  measured,
  country,
  domain,
}: {
  keywords: OrganicKeyword[];
  /** True when the rows came from Search Console. */
  measured: boolean;
  country: string;
  domain: string;
}) {
  const [keywords, setKeywords] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState("");
  // Highest estimated traffic first is the default the client asked for.
  const [sort, setSort] = useState<SortKey>("estTraffic");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [kdMin, setKdMin] = useState("");
  const [kdMax, setKdMax] = useState("");

  const columns = COLUMNS.filter((c) => measured || !c.measuredOnly);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const min = kdMin.trim() === "" ? null : Number(kdMin);
    const max = kdMax.trim() === "" ? null : Number(kdMax);

    return keywords.filter((k) => {
      if (needle !== "" && !k.keyword.toLowerCase().includes(needle)) {
        return false;
      }
      if (min !== null && Number.isFinite(min) && k.difficulty < min) {
        return false;
      }
      if (max !== null && Number.isFinite(max) && k.difficulty > max) {
        return false;
      }
      return true;
    });
  }, [keywords, query, kdMin, kdMax]);

  const sorted = useMemo(() => {
    const factor: 1 | -1 = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort === "keyword") {
        return a.keyword.localeCompare(b.keyword) * factor;
      }
      if (sort === "position" || sort === "estTraffic") {
        return compare(a[sort], b[sort], factor);
      }
      return (a[sort] - b[sort]) * factor;
    });
  }, [filtered, sort, dir]);

  const totals = useMemo(
    () => ({
      traffic: sorted.reduce((s, k) => s + (k.estTraffic ?? 0), 0),
      ranked: sorted.filter((k) => k.position !== null).length,
    }),
    [sorted],
  );

  function toggleSort(key: SortKey) {
    if (key === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      // Text reads best A→Z; every metric reads best biggest-first.
      setDir(key === "keyword" ? "asc" : "desc");
    }
  }

  function exportCsv() {
    if (sorted.length === 0) {
      toast.error("Nothing to export with these filters");
      return;
    }
    const header = [
      "keyword",
      "position",
      "position_source",
      "est_traffic",
      "clicks",
      "impressions",
      "volume",
      "cpc",
      "difficulty",
    ];
    const body = sorted.map((k) =>
      [
        `"${k.keyword.replace(/"/g, '""')}"`,
        k.position ?? "",
        k.positionSource ?? "",
        k.estTraffic ?? "",
        k.clicks,
        k.impressions,
        k.volume,
        k.cpc,
        k.difficulty,
      ].join(","),
    );
    downloadCsv(
      `${domain}-organic-keywords.csv`,
      [header.join(","), ...body].join("\n"),
    );
    toast.success(`Exported ${String(sorted.length)} keywords`);
  }

  const unchecked = keywords.filter((k) => k.position === null);

  /**
   * Looks up real positions for the highest-volume unchecked keywords.
   *
   * Opt-in and batched because each new keyword costs one SerpApi credit out
   * of a 250/month allowance — the cost is stated on the button rather than
   * being spent silently on page load.
   */
  async function checkPositions() {
    const batch = [...unchecked]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, CHECK_BATCH)
      .map((k) => k.keyword);

    if (batch.length === 0) return;
    setChecking(true);

    try {
      const res = await fetch("/api/competitors/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, country, keywords: batch }),
      });
      const data = (await res.json()) as {
        positions?: Record<string, number | null>;
        error?: string;
      };

      if (!res.ok || !data.positions) {
        toast.error(data.error ?? "Could not check positions");
        return;
      }

      const found = data.positions;
      setKeywords((prev) =>
        prev.map((k) => {
          if (!(k.keyword in found)) return k;
          const position = found[k.keyword] ?? null;
          return {
            ...k,
            position,
            positionSource: position === null ? null : "serp",
            estTraffic: estimateTraffic(position, k.volume),
          };
        }),
      );

      const ranked = Object.values(found).filter((p) => p !== null).length;
      toast.success(
        `Checked ${String(batch.length)} keywords — ${String(ranked)} ranking`,
      );
    } catch {
      toast.error("Could not reach the position checker");
    } finally {
      setChecking(false);
    }
  }

  const filtersActive =
    query.trim() !== "" || kdMin.trim() !== "" || kdMax.trim() !== "";

  const arrow = (key: SortKey) =>
    sort === key ? (dir === "asc" ? " ↑" : " ↓") : "";

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      {/* ---------- Controls ---------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="Search keywords…"
            aria-label="Search keywords"
            className="h-9 pl-8"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <label
            htmlFor="kd-min"
            className="whitespace-nowrap text-xs text-muted-foreground"
          >
            KD
          </label>
          <Input
            id="kd-min"
            type="number"
            min={0}
            max={100}
            value={kdMin}
            onChange={(e) => {
              setKdMin(e.target.value);
            }}
            placeholder="0"
            aria-label="Minimum keyword difficulty"
            className="h-9 w-16"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="number"
            min={0}
            max={100}
            value={kdMax}
            onChange={(e) => {
              setKdMax(e.target.value);
            }}
            placeholder="100"
            aria-label="Maximum keyword difficulty"
            className="h-9 w-16"
          />
        </div>

        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setKdMin("");
              setKdMax("");
            }}
            className="inline-flex h-9 items-center gap-1 rounded border border-border px-2.5 text-xs transition-colors hover:bg-accent"
          >
            <X className="size-3.5" aria-hidden />
            Clear
          </button>
        )}

        <div className="flex-1" />

        {unchecked.length > 0 && (
          <button
            type="button"
            onClick={() => void checkPositions()}
            disabled={checking}
            title={`Looks up the ${String(Math.min(CHECK_BATCH, unchecked.length))} highest-volume keywords with no known position. Uses up to that many SerpApi credits; already-cached keywords are free.`}
            className="inline-flex h-9 items-center gap-1.5 rounded border border-border px-2.5 text-xs transition-colors hover:bg-accent disabled:opacity-60"
          >
            <Crosshair
              className={cn("size-3.5", checking && "animate-spin")}
              aria-hidden
            />
            {checking
              ? "Checking…"
              : `Check ${String(Math.min(CHECK_BATCH, unchecked.length))} positions`}
          </button>
        )}

        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex h-9 items-center gap-1.5 rounded border border-border px-2.5 text-xs transition-colors hover:bg-accent"
        >
          <Download className="size-3.5" aria-hidden />
          Export
        </button>
      </div>

      {/* ---------- Summary of what is on screen ---------- */}
      <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Showing <span className="tabular font-medium text-foreground">{formatNumber(sorted.length)}</span>{" "}
        of {formatNumber(keywords.length)} keywords ·{" "}
        <span className="tabular font-medium text-foreground">{formatNumber(totals.ranked)}</span>{" "}
        with a known position ·{" "}
        <span className="tabular font-medium text-foreground">{formatNumber(totals.traffic)}</span>{" "}
        estimated monthly visits
      </p>

      {sorted.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          No keywords match these filters.
        </p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <caption className="sr-only">
              Organic keywords for {domain}, sortable and filterable
            </caption>
            <thead className="bg-muted/60">
              <tr>
                {columns.map((c) => (
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
                      "px-2 py-2 font-medium first:pl-4",
                      c.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        toggleSort(c.key);
                      }}
                      className={
                        sort === c.key
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }
                    >
                      {c.label}
                      {arrow(c.key)}
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Research
                </th>
              </tr>
            </thead>

            <tbody>
              {sorted.map((k) => (
                <tr
                  key={k.keyword}
                  className="border-t border-border hover:bg-accent/40"
                >
                  <td
                    className="max-w-[22rem] truncate py-2 pl-4 pr-2"
                    title={k.keyword}
                  >
                    {k.keyword}
                  </td>

                  <td className="tabular px-2 py-2 text-right">
                    {k.position === null ? (
                      <span
                        className="text-muted-foreground"
                        title="No measured position for this keyword yet"
                      >
                        —
                      </span>
                    ) : (
                      <span
                        title={
                          k.positionSource === "search-console"
                            ? "Average position from Search Console"
                            : "Position read from a cached Google result page"
                        }
                        className="font-medium"
                      >
                        {k.position.toFixed(1)}
                      </span>
                    )}
                  </td>

                  <td className="tabular px-2 py-2 text-right">
                    {k.estTraffic === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      formatNumber(k.estTraffic)
                    )}
                  </td>

                  {measured && (
                    <>
                      <td className="tabular px-2 py-2 text-right">
                        {formatNumber(k.clicks)}
                      </td>
                      <td className="tabular px-2 py-2 text-right text-muted-foreground">
                        {formatNumber(k.impressions)}
                      </td>
                    </>
                  )}

                  <td className="tabular px-2 py-2 text-right">
                    {formatVolume(k.volume)}
                  </td>
                  <td className="tabular px-2 py-2 text-right">
                    {formatCpc(k.cpc)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <ScorePill score={k.difficulty} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/keywords?q=${encodeURIComponent(k.keyword)}&country=${country}`}
                      className="text-primary hover:underline"
                    >
                      Analyse
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
