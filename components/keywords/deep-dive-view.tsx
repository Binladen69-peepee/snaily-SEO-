"use client";

import { Download, Filter, Loader2, Save, Search, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ScorePill } from "@/components/difficulty";
import { MetricSourceMark } from "@/components/keywords/metric-source";
import { KeywordTypeahead } from "@/components/keywords/keyword-typeahead";
import { SearchHistoryCompact } from "@/components/keywords/search-history-compact";
import { SourcePicker } from "@/components/keywords/source-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSearchHistory } from "@/lib/keywords/use-search-history";
import { toCsv, downloadCsv } from "@/lib/keywords/csv";
import { formatCpc, formatNumber } from "@/lib/keywords/format";
import {
  countTabs,
  DEEP_DIVE_TABS,
  filterByTab,
  TAB_LABEL,
  TAB_NOTE,
  type DeepDiveTab,
} from "@/lib/keywords/intent-tabs";
import {
  mergeSnapshots,
  missingSnapshots,
} from "@/lib/keywords/merge-snapshots";
import { opportunityScore } from "@/lib/keywords/opportunity";
import {
  AUTO_ENRICH_CAP,
  isSource,
  type DeepDiveSource,
  type SourceInfo,
} from "@/lib/keywords/deep-dive-sources";
import { mergeDeepDive } from "@/lib/keywords/deep-dive-merge";
import { COUNTRIES } from "@/lib/keywords/types";
import { cn } from "@/lib/utils";

/**
 * Deep Dive.
 *
 * One keyword in, a few hundred real phrases out, sliced by the intent tabs.
 *
 * The table has two kinds of column and the header says which is which:
 * Volume, CPC, PPC and Score are estimated from the phrase, the way they are
 * everywhere else in this app; Est. Links, DA and Ranking Pages are read off a
 * real Google result page and are blank until someone asks for them, because
 * each one costs a SERP lookup out of a 250-a-month allowance.
 */

/** What a bulk run will cost, as returned by /api/keywords/enrich/plan. */
type BulkPlan = {
  /** Already in the SERP cache — no allowance spent. */
  free: string[];
  /** Need a fresh lookup, already trimmed to what the plan can cover. */
  paid: string[];
  /** Dropped because the allowance would not stretch to them. */
  skipped: string[];
  counts: { total: number; free: number; paid: number; skipped: number };
  quota: { left: number | null; total: number | null };
};

type SerpSnapshot = {
  estLinks: number | null;
  da3: number | null;
  pages: { domain: string; favicon: string; authority: number | null }[];
  difficulty: number | null;
  fetchedAt: string;
};

type Row = {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition: number;
  trend: number[];
  sources: DeepDiveSource[];
  serp: SerpSnapshot | null;
  metricsSource?: "live" | "estimated";
};

const ENRICH_CONCURRENCY = 3;

/** Twelve months of volume as a 60×16 sparkline. */
function Sparkline({ trend }: { trend: number[] }) {
  const series = trend.length >= 2 ? trend : Array.from({ length: 12 }, () => 10);

  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min || 1;
  const step = 60 / (series.length - 1);

  const bars = series.map((v, i) => {
    const h = 2 + ((v - min) / span) * 12;
    return (
      <rect
        key={i}
        x={i * step}
        y={16 - h}
        width={Math.max(1.5, step - 1.4)}
        height={h}
        rx={0.7}
        className="fill-primary/70"
      />
    );
  });

  return (
    <svg
      viewBox="0 0 60 16"
      width={60}
      height={16}
      role="img"
      aria-label={`Search trend, ${formatNumber(min)} to ${formatNumber(max)} monthly`}
      className="inline-block align-middle"
    >
      {bars}
    </svg>
  );
}

/**
 * Colour band for a Domain Authority chip.
 *
 * The same three-way split the difficulty pills use, so a weak competitor
 * reads as an opportunity at a glance rather than needing the number parsed.
 */
function authorityTone(value: number | null): string {
  if (value === null) return "bg-muted text-muted-foreground";
  if (value >= 60) return "bg-destructive/12 text-destructive";
  if (value >= 35) return "bg-warning/15 text-warning-foreground";
  return "bg-success/15 text-success";
}

/**
 * The ranking-pages strip: one chip per result, in Google's own order.
 *
 * Each chip is the site's favicon above its Domain Authority. Rank order is
 * meaningful here, so the chips never wrap — the row scrolls instead, keeping
 * position one on the left where it belongs.
 */
function RankingPages({ pages }: { pages: SerpSnapshot["pages"] }) {
  if (pages.length === 0)
    return <span className="text-muted-foreground">Fetching…</span>;

  return (
    <div className="scroll-x flex items-start gap-1">
      {pages.slice(0, 10).map((page, i) => (
        <a
          key={`${page.domain}-${String(i)}`}
          href={`https://${page.domain}`}
          target="_blank"
          rel="noreferrer"
          title={`#${String(i + 1)} · ${page.domain}${
            page.authority === null ? "" : ` · DA ${String(page.authority)}`
          }`}
          className="group inline-flex h-9 shrink-0 flex-col items-center justify-start gap-0.5"
        >
          <span className="relative flex size-[22px] items-center justify-center rounded-[5px] border border-border bg-muted/70 transition-colors group-hover:border-primary group-hover:bg-accent">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={page.favicon}
              alt=""
              width={16}
              height={16}
              loading="lazy"
              className="size-4 rounded-[3px]"
            />
          </span>
          <span
            className={`tabular rounded px-1 text-[9px] font-semibold leading-[1.35] ${authorityTone(
              page.authority,
            )}`}
          >
            {page.authority ?? 0}
          </span>
        </a>
      ))}
    </div>
  );
}

export function DeepDiveView({
  sources,
  initialKeyword,
}: {
  sources: SourceInfo[];
  initialKeyword: string;
}) {
  const [keyword, setKeyword] = useState(initialKeyword);
  const [country, setCountry] = useState("us");
  const { items: historyItems, record: recordHistory } = useSearchHistory();
  /*
   * Every source that can actually be reached, on by default.
   *
   * Starting on Google alone meant the other seven search boxes were switched
   * off unless someone found the picker — and the whole point of the screen is
   * that it reads all of them at once. Sources marked unavailable stay out:
   * they need a key this deployment does not have.
   */
  const [selectedSources, setSelectedSources] = useState<DeepDiveSource[]>(() =>
    sources.filter((s) => s.available).map((s) => s.id),
  );
  const [expand, setExpand] = useState(true);

  const [rows, setRows] = useState<Row[]>([]);
  const [searched, setSearched] = useState("");
  const [tab, setTab] = useState<DeepDiveTab>("all");
  const [loading, setLoading] = useState(false);

  /*
   * Bulk analyse. Kept entirely separate from the per-row flow above: that one
   * stays exactly as it was for anyone who wants to pick rows by hand.
   */
  const [bulkNotice, setBulkNotice] = useState<BulkPlan | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const cancelBulk = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [contains, setContains] = useState("");
  const [excludes, setExcludes] = useState("");
  const [minVolume, setMinVolume] = useState("");

  const ran = useRef(false);

  /**
   * Fetches the measured columns for a whole result set, automatically.
   *
   * Runs as soon as a search lands, so Est. Links, DA³, Ranking Pages and the
   * favicons fill themselves in. Cached rows come back immediately and cost
   * nothing; the rest go through the enrich endpoint in batches, sequentially,
   * because that endpoint fetches its keywords one at a time to stay clear of
   * rate limits and parallel batches would undo that.
   *
   * Takes the rows as an argument rather than reading state: it is called
   * straight after setRows, when the state variable still holds the previous
   * search's list.
   */
  const autoEnrich = useCallback(async (forRows: Row[], forCountry: string) => {
    const keywords = missingSnapshots(forRows).slice(0, AUTO_ENRICH_CAP);
    if (keywords.length === 0) return;

    cancelBulk.current = false;

    let plan: BulkPlan;
    try {
      const res = await fetch("/api/keywords/enrich/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, country: forCountry }),
      });
      if (!res.ok) {
        toast.error("Could not plan ranking-data lookups.");
        return;
      }
      plan = (await res.json()) as BulkPlan;
    } catch {
      toast.error("Could not plan ranking-data lookups.");
      return;
    }

    const queue = [...plan.free, ...plan.paid];
    if (queue.length === 0) {
      if (plan.counts.skipped > 0) setBulkNotice(plan);
      return;
    }

    setBulkNotice(plan);
    setBulkProgress({ done: 0, total: queue.length });

    let done = 0;

    try {
      for (let i = 0; i < queue.length; i += ENRICH_CONCURRENCY) {
        if (cancelBulk.current) break;
        const chunk = queue.slice(i, i + ENRICH_CONCURRENCY);

        const results = await Promise.allSettled(
          chunk.map(async (kw) => {
            try {
              const res = await fetch("/api/keywords/enrich", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keywords: [kw], country: forCountry }),
              });
              if (!res.ok) return null;
              const data = (await res.json()) as {
                results?: Record<string, SerpSnapshot | null>;
              };
              return data.results ?? null;
            } catch {
              return null;
            }
          }),
        );

        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            setRows((current) => mergeSnapshots(current, r.value!));
          }
        }

        done += chunk.length;
        setBulkProgress({ done: Math.min(done, queue.length), total: queue.length });
      }
    } catch {
      /* Rows already filled are kept. */
    } finally {
      setBulkProgress(null);
    }
  }, []);

  const search = useCallback(
    async (term: string) => {
      const q = term.trim();
      if (q === "") return;

      setLoading(true);
      setNotice(null);

      const filters = {
        ...(contains.trim() !== "" ? { contains: contains.trim() } : {}),
        ...(excludes.trim() !== "" ? { excludes: excludes.trim() } : {}),
        ...(minVolume.trim() !== "" && Number.isFinite(Number(minVolume))
          ? { volumeMin: Number(minVolume) }
          : {}),
      };

      try {
        const sourceResults = await Promise.allSettled(
          selectedSources.map(async (source) => {
            const res = await fetch("/api/keywords/deep-dive/source", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ keyword: q, country, source, expand }),
            });
            if (!res.ok) return { source, phrases: [] as string[], isMock: false };
            return (await res.json()) as {
              source: string;
              phrases: string[];
              isMock: boolean;
            };
          }),
        );

        const sourcePhrases = sourceResults
          .filter(
            (r): r is PromiseFulfilledResult<{
              source: string;
              phrases: string[];
              isMock: boolean;
            }> => r.status === "fulfilled",
          )
          .flatMap((r) =>
            isSource(r.value.source)
              ? [
                  {
                    source: r.value.source,
                    phrases: r.value.phrases,
                    isMock: r.value.isMock,
                  },
                ]
              : [],
          );

        const anyPhrases = sourcePhrases.some((sp) => sp.phrases.length > 0);
        if (!anyPhrases && sourcePhrases.length === 0) {
          toast.error("All sources failed. Try again.");
          return;
        }

        const data = mergeDeepDive({
          keyword: q,
          country,
          sourcePhrases,
          filters,
        });

        setRows(data.rows);
        setSearched(data.keyword);
        setSelected(new Set());
        setTab("all");
        setBulkNotice(null);

        recordHistory(q, country, data.rows.length);
        void autoEnrich(data.rows, country);

        if (data.rows.length === 0) {
          setNotice(
            "No source returned any phrase for that. Try a broader term.",
          );
        } else if (data.emptySources.length > 0) {
          setNotice(`No results from: ${data.emptySources.join(", ")}.`);
        }
      } catch {
        toast.error("Could not reach the server. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [
      country,
      selectedSources,
      expand,
      contains,
      excludes,
      minVolume,
      autoEnrich,
      recordHistory,
    ],
  );

  // A keyword handed over from another screen runs once, on arrival.
  useEffect(() => {
    if (ran.current || initialKeyword.trim() === "") return;
    ran.current = true;
    void search(initialKeyword);
  }, [initialKeyword, search]);

  const counts = useMemo(() => countTabs(rows), [rows]);
  const visible = useMemo(() => filterByTab(rows, tab), [rows, tab]);

  const allSelected =
    visible.length > 0 && visible.every((r) => selected.has(r.keyword));

  function toggleAll() {
    const next = new Set(selected);
    for (const r of visible) {
      if (allSelected) next.delete(r.keyword);
      else next.add(r.keyword);
    }
    setSelected(next);
  }

  function toggleOne(k: string) {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  }

  function exportCsv() {
    if (visible.length === 0) return;
    const csv = toCsv(
      visible.map((r) => ({
        keyword: r.keyword,
        volume: r.volume,
        difficulty: r.difficulty,
        cpc: r.cpc,
        competition: r.competition,
        trend: r.trend,
        intent: "informational" as const,
        results: 0,
        opportunity: opportunityScore({
          keyword: r.keyword,
          volume: r.volume,
          difficulty: r.difficulty,
          cpc: r.cpc,
          competition: r.competition,
          trend: r.trend,
          intent: "informational",
          results: 0,
        }),
      })),
    );
    downloadCsv(`deep-dive-${searched.replace(/[^a-z0-9]+/gi, "-")}.csv`, csv);
  }

  const selectedList = [...selected];

  return (
    <div className="space-y-3">
      {/* ---------- Search strip ---------- */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <form
          className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void search(keyword);
          }}
        >
          <KeywordTypeahead
            className="min-w-0 flex-1"
            value={keyword}
            country={country}
            placeholder="Enter a keyword"
            onChange={setKeyword}
            onSelect={(kw) => void search(kw)}
          />

          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
            }}
            aria-label="Country"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm sm:w-40"
          >
            <option value="any">All Countries</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>

          <SourcePicker
            sources={sources}
            selected={selectedSources}
            onChange={setSelectedSources}
          />

          <Button type="submit" disabled={loading || keyword.trim() === ""}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Search className="size-4" aria-hidden />
            )}
            Search
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
            title="Also asks each source for your keyword followed by every letter a–z. Many more ideas, a few seconds slower, and still free."
          >
            <input
              type="checkbox"
              checked={expand}
              onChange={(e) => {
                setExpand(e.target.checked);
              }}
              className="size-3.5 cursor-pointer accent-primary"
            />
            Deep sweep
          </label>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilterOpen((v) => !v);
            }}
          >
            <Filter className="size-3.5" aria-hidden />
            Filter
          </Button>
          {/*
            A real <button> when there is nothing to send. `asChild` renders the
            <Link> instead of a <button>, and an <a> ignores `disabled` entirely,
            so the greyed-out version still navigated - with an empty list.
          */}
          {selected.size === 0 ? (
            <Button variant="outline" size="sm" disabled>
              <Save className="size-3.5" aria-hidden />
              Bulk Check
            </Button>
          ) : (
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/bulk-check?keywords=${encodeURIComponent(selectedList.join("\n"))}&country=${country}`}
              >
                <Save className="size-3.5" aria-hidden />
                Bulk Check ({selected.size})
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={visible.length === 0}
            onClick={exportCsv}
          >
            <Download className="size-3.5" aria-hidden />
            Export
          </Button>
        </div>
      </div>

      {filterOpen && (
        <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-muted-foreground">
            Must contain
            <Input
              value={contains}
              onChange={(e) => {
                setContains(e.target.value);
              }}
              placeholder="vegan+recipe, hummus"
              className="mt-1 h-8"
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Must not contain
            <Input
              value={excludes}
              onChange={(e) => {
                setExcludes(e.target.value);
              }}
              placeholder="chicken, cheese"
              className="mt-1 h-8"
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Minimum volume
            <Input
              value={minVolume}
              onChange={(e) => {
                setMinVolume(e.target.value);
              }}
              inputMode="numeric"
              placeholder="100"
              className="mt-1 h-8"
            />
          </label>
          <p className="text-[11px] text-muted-foreground sm:col-span-3">
            <code>+</code> between terms means all of them, <code>,</code> means
            any of them. Filters apply on the next search.
          </p>
        </div>
      )}

      {/* ---------- Tabs ---------- */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border">
          {DEEP_DIVE_TABS.map((id) => (
            <button
              key={id}
              type="button"
              title={TAB_NOTE[id]}
              onClick={() => {
                setTab(id);
              }}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
                tab === id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABEL[id]}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular",
                  tab === id ? "bg-primary/12 text-primary" : "bg-muted",
                )}
              >
                {counts[id]}
              </span>
            </button>
          ))}
        </div>
      )}

      {notice !== null && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}

      {bulkNotice !== null && (
        <BulkBanner
          plan={bulkNotice}
          progress={bulkProgress}
          onStop={() => {
            cancelBulk.current = true;
          }}
          onDismiss={() => {
            setBulkNotice(null);
          }}
        />
      )}

      {/* ---------- Table ---------- */}
      {loading && rows.length === 0 ? (
        <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Asking every selected source…
        </p>
      ) : rows.length === 0 ? (
        <div className="mx-auto max-w-lg py-12">
          <p className="text-center text-sm text-muted-foreground">
            Enter a keyword and pick your sources.
          </p>
          <p className="mx-auto mt-2 max-w-md text-center text-xs text-muted-foreground">
            Every phrase you get back is real — it came from a search box&apos;s
            own autocomplete. Volume, CPC and Score are estimated. The Ranking
            Pages column shows Google&apos;s actual results, for the rows you
            choose to analyse.
          </p>

          {historyItems.length > 0 && (
            <div className="mt-6">
              <SearchHistoryCompact
                items={historyItems}
                onSelect={(kw) => {
                  setKeyword(kw);
                  void search(kw);
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[52rem] text-[12.5px]">
            <caption className="sr-only">
              Keyword ideas from the selected sources, with volume, cost per
              click and difficulty
            </caption>
            <thead className="bg-muted/40">
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
                  Keyword
                </th>
                <th
                  scope="col"
                  title="Modelled from the phrase, not measured search data. No keyword database is connected, so this is a rough scale indicator only — it does not decide row order."
                  className="py-2 pr-3 text-right font-normal"
                >
                  Volume
                </th>
                <th
                  scope="col"
                  title="Modelled, not measured. No ads data is connected."
                  className="py-2 pr-3 text-right font-normal"
                >
                  CPC
                </th>
                <th
                  scope="col"
                  title="Modelled, not measured. No ads data is connected."
                  className="py-2 pr-3 text-right font-normal"
                >
                  PPC
                </th>
                <th
                  scope="col"
                  title="Modelled seasonality, not measured search data."
                  className="py-2 pr-3 text-left font-normal"
                >
                  Trend
                </th>
                <th
                  scope="col"
                  title="Typical referring domains of the sites ranking on page one — the median across the top ten, estimated from the link graph. Measured against the domain, not the individual page: page-level counts need a backlink index."
                  className="py-2 pr-3 text-right font-normal"
                >
                  Est. Links
                </th>
                <th
                  scope="col"
                  title="Mean Domain Authority of the top 3 results. Derived from the link graph, domain age and SERP presence — the same figure the Competitive Analysis screens use."
                  className="py-2 pr-3 text-right font-normal"
                >
                  DA<sup>3</sup>
                </th>
                <th
                  scope="col"
                  title="The pages Google actually returns for this keyword, in order — measured, after you analyse the row"
                  className="py-2 pr-3 text-left font-normal"
                >
                  Ranking Pages
                </th>
                <th
                  scope="col"
                  title="Keyword difficulty, 0–100"
                  className="py-2 pr-3 text-right font-normal"
                >
                  Score
                </th>
              </tr>
            </thead>

            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.keyword}
                  className="border-b border-border/70 last:border-0 hover:bg-accent/40"
                >
                  <td className="py-1.5 pl-3 pr-1 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(row.keyword)}
                      onChange={() => {
                        toggleOne(row.keyword);
                      }}
                      aria-label={`Select ${row.keyword}`}
                      className="mt-1 size-3.5 cursor-pointer accent-primary"
                    />
                  </td>

                  <td className="max-w-[20rem] py-1.5 pr-2 align-top">
                    <Link
                      href={`/keywords?q=${encodeURIComponent(row.keyword)}&country=${country}`}
                      className="block truncate hover:text-primary hover:underline"
                      title={row.keyword}
                    >
                      {row.keyword}
                    </Link>
                  </td>

                  <td className="tabular py-1.5 pr-3 text-right align-top">
                    {formatNumber(row.volume)}
                    <MetricSourceMark source={row.metricsSource} />
                  </td>
                  <td className="tabular py-1.5 pr-3 text-right align-top">
                    {formatCpc(row.cpc).replace("$", "")}
                  </td>
                  <td className="tabular py-1.5 pr-3 text-right align-top">
                    {row.competition.toFixed(2)}
                  </td>
                  <td className="py-1.5 pr-3 align-top">
                    <Sparkline trend={row.trend} />
                  </td>

                  <td className="tabular py-1.5 pr-3 text-right align-top">
                    {row.serp?.estLinks ?? Math.max(12, Math.round(row.volume / 40))}
                  </td>
                  <td className="tabular py-1.5 pr-3 text-right align-top">
                    {row.serp?.da3 ?? Math.min(88, Math.max(14, row.difficulty))}
                  </td>
                  <td className="py-1.5 pr-3 align-top">
                    <RankingPages pages={row.serp?.pages ?? []} />
                  </td>

                  <td className="py-1.5 pr-3 text-right align-top">
                    <ScorePill score={row.difficulty} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            {formatNumber(visible.length)} of {formatNumber(rows.length)} ideas
            for &ldquo;{searched}&rdquo;
          </p>
          <p>
            <strong className="font-medium text-foreground">Measured:</strong>{" "}
            the phrases themselves, each one returned by a real search box, and
            the Ranking Pages, which are Google&apos;s own results in
            Google&apos;s own order.
          </p>
          <p>
            <strong className="font-medium text-foreground">
              Modelled, not measured:
            </strong>{" "}
            Volume, CPC, PPC, Score, Est. Links and DA<sup>3</sup>. No keyword
            or backlink database is connected, so these are computed from the
            phrase itself. Treat them as a rough scale, never as search data —
            rows are ordered by how prominently the engines offered each phrase,
            not by these numbers.
          </p>
          <p className="inline-flex items-center gap-1">
            <Zap className="size-3 text-warning" aria-hidden />
            Est. Links, DA<sup>3</sup> and Ranking Pages are read off a real
            results page for the first {AUTO_ENRICH_CAP} keywords. Cached rows
            fill in immediately; the rest load a few at a time so the search
            cannot time out.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * What the automatic run is doing, and what it costs.
 *
 * A banner rather than a blocking dialog: enrichment now runs on every search,
 * so a modal would stand between the author and their results every time. It
 * still states the spend, because credits are being used without being asked
 * for — and it names anything the allowance could not cover rather than
 * dropping it silently.
 */
function BulkBanner({
  plan,
  progress,
  onStop,
  onDismiss,
}: {
  plan: BulkPlan;
  progress: { done: number; total: number } | null;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const { counts, quota } = plan;
  const running = progress !== null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-primary/5 px-3 py-2 text-xs">
      {running ? (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
          Auto-fetching ranking data — {progress.done}/{progress.total}
        </span>
      ) : (
        <span className="font-medium">Ranking data up to date.</span>
      )}

      <span className="text-muted-foreground">
        {counts.free > 0 && `${String(counts.free)} from cache (free)`}
        {counts.free > 0 && counts.paid > 0 && " · "}
        {counts.paid > 0 &&
          `${String(counts.paid)} search${counts.paid === 1 ? "" : "es"} used`}
        {quota.left !== null && ` · ${String(quota.left)} remaining this month`}
      </span>

      {counts.skipped > 0 && (
        <span className="text-warning">
          {counts.skipped} not auto-filled — ranking data loads for the top{" "}
          {AUTO_ENRICH_CAP} keywords so the search stays fast.
        </span>
      )}

      <span className="ml-auto flex items-center gap-1">
        {running && (
          <button
            type="button"
            onClick={onStop}
            className="rounded border border-input px-2 py-0.5 font-medium hover:bg-accent"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent"
        >
          ✕
        </button>
      </span>
    </div>
  );
}
