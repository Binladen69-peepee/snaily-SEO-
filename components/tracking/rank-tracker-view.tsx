"use client";

import {
  BarChart3,
  Bell,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadCsv } from "@/lib/keywords/csv";
import { formatVolume } from "@/lib/keywords/format";
import { ENGINES, type TrackedRow, type TrackerSummary } from "@/lib/rank-tracker";
import { cn } from "@/lib/utils";

/** Ring segments, in the order KeySearch lists them. */
const SEGMENTS = [
  { key: "top3", label: "Top 3", color: "var(--chart-1)" },
  { key: "top10", label: "Top 10", color: "var(--chart-2)" },
  { key: "top100", label: "Top 100", color: "var(--chart-3)" },
  { key: "notSeen", label: "Not Seen", color: "var(--chart-muted)" },
] as const;

/** Donut of where the tracked keywords sit. Bands are exclusive. */
function PositionsDonut({ summary }: { summary: TrackerSummary }) {
  const bands = {
    top3: summary.top3,
    top10: Math.max(0, summary.top10 - summary.top3),
    top100: Math.max(0, summary.top100 - summary.top10),
    notSeen: summary.notSeen,
  };
  const total = Object.values(bands).reduce((a, b) => a + b, 0);

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        width={140}
        height={140}
        viewBox="0 0 140 140"
        role="img"
        aria-label={`${String(summary.top3)} in the top 3, ${String(summary.top10)} in the top 10, ${String(summary.notSeen)} not seen`}
      >
        <g transform="translate(70,70) rotate(-90)">
          <circle r={radius} fill="none" strokeWidth={22} className="stroke-muted" />
          {total > 0 &&
            SEGMENTS.map((s) => {
              const value = bands[s.key];
              if (value === 0) return null;
              const length = (value / total) * circumference;
              const dash = `${String(length)} ${String(circumference - length)}`;
              const el = (
                <circle
                  key={s.key}
                  r={radius}
                  fill="none"
                  strokeWidth={22}
                  stroke={s.color}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                />
              );
              offset += length;
              return el;
            })}
        </g>
      </svg>

      <ul className="space-y-1.5 text-sm">
        {SEGMENTS.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-3 rounded-sm"
              style={{ background: s.color }}
            />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="tabular font-medium">
              (
              {s.key === "top3"
                ? summary.top3
                : s.key === "top10"
                  ? summary.top10
                  : s.key === "top100"
                    ? summary.top100
                    : summary.notSeen}
              )
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Inline rank history, drawn with position 1 at the top. */
function RankChart({ history }: { history: TrackedRow["history"] }) {
  const points = history.filter((h) => h.rank !== null) as {
    date: string;
    rank: number;
  }[];

  if (points.length < 2) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        Only one measurement so far — check again tomorrow and a trend line
        appears here.
      </p>
    );
  }

  const w = 720;
  const h = 200;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const ranks = points.map((p) => p.rank);
  const best = Math.min(...ranks);
  const worst = Math.max(...ranks);
  const span = Math.max(1, worst - best);

  const x = (i: number) =>
    pad.left + (i / (points.length - 1)) * (w - pad.left - pad.right);
  // Inverted: a better rank (lower number) sits higher on the chart.
  const y = (rank: number) =>
    pad.top + ((rank - best) / span) * (h - pad.top - pad.bottom);

  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`);
  const ticks = [best, best + span / 2, worst].map(
    (v) => Math.round(v * 10) / 10,
  );

  return (
    <div className="overflow-x-auto p-4">
      <svg
        viewBox={`0 0 ${String(w)} ${String(h)}`}
        className="h-48 w-full min-w-[36rem]"
        role="img"
        aria-label={`Rank history from ${String(points[0]!.rank)} to ${String(points[points.length - 1]!.rank)}`}
      >
        {[...new Set(ticks)].map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={w - pad.right}
              y1={y(t)}
              y2={y(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={pad.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {t}
            </text>
          </g>
        ))}

        <polyline
          points={path.join(" ")}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <circle
            key={p.date}
            cx={x(i)}
            cy={y(p.rank)}
            r={i === points.length - 1 ? 5 : 3.5}
            fill="var(--chart-1)"
          >
            <title>{`${p.date.slice(0, 10)} — Rank: ${String(p.rank)}`}</title>
          </circle>
        ))}

        {[0, points.length - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={h - 8}
            textAnchor={i === 0 ? "start" : "end"}
            className="fill-muted-foreground text-[11px]"
          >
            {points[i]!.date.slice(0, 10)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function Change({ change }: { change: number | null }) {
  if (change === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (change === 0) {
    return <span className="tabular text-sm text-muted-foreground">0</span>;
  }
  const up = change > 0;
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-0.5 text-sm font-medium",
        up ? "text-success" : "text-destructive",
      )}
    >
      {up ? "▲" : "▼"}
      {Math.abs(change)}
    </span>
  );
}

export function RankTrackerView({
  initial,
  projectId,
  domain,
  discovered,
  searchConsoleReady,
}: {
  initial: TrackedRow[];
  projectId: string;
  domain: string;
  discovered: { keyword: string; position: number; impressions: number }[];
  searchConsoleReady: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"none" | "checking" | "adding">("none");

  const [addOpen, setAddOpen] = useState(false);
  const [foundOpen, setFoundOpen] = useState(false);
  const [engine, setEngine] = useState<string>(ENGINES[0].value);
  const [localized, setLocalized] = useState(false);
  const [location, setLocation] = useState("");
  const [groupName, setGroupName] = useState("");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const summary = useMemo(() => {
    const ranked = rows.filter((r) => r.rank !== null);
    return {
      total: rows.length,
      top3: rows.filter((r) => r.rank !== null && r.rank <= 3).length,
      top10: rows.filter((r) => r.rank !== null && r.rank <= 10).length,
      top100: ranked.length,
      notSeen: rows.length - ranked.length,
      improved: rows.filter((r) => (r.change ?? 0) > 0).length,
      declined: rows.filter((r) => (r.change ?? 0) < 0).length,
      netChange: rows.reduce((s, r) => s + (r.change ?? 0), 0),
      averageRank:
        ranked.length === 0
          ? null
          : Math.round(
              (ranked.reduce((s, r) => s + (r.rank ?? 0), 0) / ranked.length) *
                10,
            ) / 10,
    } satisfies TrackerSummary;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? rows
      : rows.filter((r) => r.keyword.toLowerCase().includes(needle));
  }, [rows, query]);

  const engineCountry =
    ENGINES.find((e) => e.value === engine)?.country ?? "us";

  async function submitKeywords(list: string[]) {
    if (list.length === 0) return;
    setBusy("adding");
    try {
      const res = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          keywords: list,
          engine,
          country: engineCountry,
          location: localized ? location : null,
          groupName,
        }),
      });
      const data = (await res.json()) as {
        added?: number;
        skipped?: number;
        keywords?: TrackedRow[];
        error?: string;
      };

      if (!res.ok || !data.keywords) {
        toast.error(data.error ?? "Could not add keywords");
        return;
      }

      setRows(data.keywords);
      setAddOpen(false);
      setFoundOpen(false);
      setText("");
      setPicked(new Set());
      toast.success(
        `Added ${String(data.added ?? 0)} keyword${data.added === 1 ? "" : "s"}` +
          (data.skipped ? ` · ${String(data.skipped)} already tracked` : ""),
      );
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy("none");
    }
  }

  async function check(ids?: string[]) {
    setBusy("checking");
    try {
      const res = await fetch("/api/tracking/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...(ids ? { ids } : {}) }),
      });
      const data = (await res.json()) as {
        checked?: number;
        ranked?: number;
        keywords?: TrackedRow[];
        error?: string;
      };

      if (!res.ok || !data.keywords) {
        toast.error(data.error ?? "Could not check ranks");
        return;
      }

      setRows(data.keywords);
      toast.success(
        `Checked ${String(data.checked ?? 0)} · ${String(data.ranked ?? 0)} ranking in the top 100`,
      );
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy("none");
    }
  }

  async function remove(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`Stop tracking ${String(ids.length)} keyword(s)?`)) return;

    try {
      const res = await fetch("/api/tracking", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        toast.error("Could not remove keywords");
        return;
      }
      setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
      setSelected(new Set());
      toast.success("Removed from tracking");
    } catch {
      toast.error("Could not reach the server");
    }
  }

  function exportCsv() {
    if (rows.length === 0) {
      toast.error("Nothing to export yet");
      return;
    }
    const header = "keyword,rank,change,volume,engine,location,group,updated";
    const body = rows.map((r) =>
      [
        `"${r.keyword.replace(/"/g, '""')}"`,
        r.rank ?? "",
        r.change ?? "",
        r.volume,
        r.engine,
        `"${r.location ?? ""}"`,
        `"${r.groupName ?? ""}"`,
        r.checkedAt?.slice(0, 10) ?? "",
      ].join(","),
    );
    downloadCsv(`${domain}-rank-tracking.csv`, [header, ...body].join("\n"));
    toast.success(`Exported ${String(rows.length)} keywords`);
  }

  const allShown =
    visible.length > 0 && visible.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      {/* ---------- Domain header ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">{domain}</h1>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFoundOpen(true);
          }}
          disabled={discovered.length === 0}
          title={
            discovered.length === 0
              ? "Needs Search Console data to suggest keywords you already rank for"
              : `${String(discovered.length)} keywords found from Search Console`
          }
        >
          <Bell />
          We&apos;ve Found Keywords!
          {discovered.length > 0 && (
            <span className="tabular ml-1 rounded bg-primary/12 px-1.5 text-xs text-primary">
              {discovered.length}
            </span>
          )}
        </Button>

        <Button
          size="sm"
          onClick={() => {
            setAddOpen(true);
          }}
        >
          <Plus />
          Add Keywords
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void check()}
          disabled={busy !== "none" || rows.length === 0}
        >
          {busy === "checking" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
          {busy === "checking" ? "Checking…" : "Check ranks"}
        </Button>
      </div>

      {!searchConsoleReady && (
        <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-muted-foreground">
          Search Console is authorised but <strong>no property is selected</strong>,
          so Google has never synced and cannot suggest keywords you already rank
          for. Live rank checks below work regardless.{" "}
          <Link
            href={projectId ? `/projects/${projectId}` : "/projects"}
            className="text-primary hover:underline"
          >
            Choose a property
          </Link>
          .
        </p>
      )}

      {/* ---------- Summary ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Keyword Positions</h2>
          <PositionsDonut summary={summary} />
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Keyword Stats</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "tabular rounded-lg px-3 py-2 text-lg font-semibold",
                summary.netChange >= 0
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {summary.netChange >= 0 ? "▲" : "▼"}{" "}
              {Math.abs(summary.netChange)}
              <span className="ml-1 text-xs font-normal">Net rank change</span>
            </span>
            <span className="tabular rounded bg-destructive/10 px-2 py-1 text-sm text-destructive">
              {summary.declined} ▼
            </span>
            <span className="tabular rounded bg-success/10 px-2 py-1 text-sm text-success">
              {summary.improved} ▲
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-6 text-sm">
            <p>
              <span className="text-muted-foreground">Average Rank:</span>{" "}
              <span className="tabular font-medium">
                {summary.averageRank ?? "—"}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">Total Keywords:</span>{" "}
              <span className="tabular font-medium">{summary.total}</span>
            </p>
          </div>
        </section>
      </div>

      {/* ---------- Toolbar ---------- */}
      <div className="flex flex-wrap items-center gap-2">
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
            placeholder="Search tracked keywords…"
            aria-label="Search tracked keywords"
            className="h-9 pl-8"
          />
        </div>

        <div className="flex-1" />

        {selected.size > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void check([...selected])}
              disabled={busy !== "none"}
            >
              <RefreshCw />
              Check {selected.size}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void remove([...selected])}
            >
              <Trash2 />
              Remove {selected.size}
            </Button>
          </>
        )}

        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download />
          Export
        </Button>
      </div>

      {/* ---------- Table ---------- */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <caption className="sr-only">Tracked keywords for {domain}</caption>
            <thead className="border-b border-border bg-muted/40">
              <tr className="text-muted-foreground">
                <th scope="col" className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allShown}
                    onChange={() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const r of visible) {
                          if (allShown) next.delete(r.id);
                          else next.add(r.id);
                        }
                        return next;
                      });
                    }}
                    aria-label="Select all keywords"
                    className="size-3.5 cursor-pointer accent-primary"
                  />
                </th>
                <th scope="col" className="px-3 py-2.5 text-left font-normal">
                  Keyword
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">
                  Rank
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">
                  Change
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">
                  Volume
                </th>
                <th scope="col" className="px-3 py-2.5 text-left font-normal">
                  Updated
                </th>
                <th scope="col" className="px-3 py-2.5 text-left font-normal">
                  Loc
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">
                  Options
                </th>
              </tr>
            </thead>

            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
                    <BarChart3
                      className="mx-auto size-9 text-muted-foreground/50"
                      aria-hidden
                    />
                    <p className="mt-3 font-medium">
                      {rows.length === 0
                        ? "No keywords tracked yet"
                        : "Nothing matches that search"}
                    </p>
                    {rows.length === 0 && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Add keywords and press Check ranks to record their first
                        position.
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <>
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-0 hover:bg-accent/30"
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            });
                          }}
                          aria-label={`Select ${r.keyword}`}
                          className="size-3.5 cursor-pointer accent-primary"
                        />
                      </td>
                      <td className="max-w-[18rem] px-3 py-2.5">
                        <span className="block truncate font-medium" title={r.keyword}>
                          {r.keyword}
                        </span>
                        {r.groupName !== null && (
                          <span className="text-xs text-muted-foreground">
                            {r.groupName}
                          </span>
                        )}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right font-medium">
                        {r.rank ?? (
                          <span
                            className="text-muted-foreground"
                            title="Not in the top 100"
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Change change={r.change} />
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">
                        {formatVolume(r.volume)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {r.checkedAt === null
                          ? "never"
                          : new Date(r.checkedAt).toLocaleString("en-US", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase"
                          title={r.location ?? r.engine}
                        >
                          {r.country}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setExpanded((e) => (e === r.id ? null : r.id));
                          }}
                          aria-label={`Rank history for ${r.keyword}`}
                          aria-expanded={expanded === r.id}
                          className={cn(
                            "rounded p-1 transition-colors hover:bg-accent",
                            expanded === r.id
                              ? "text-primary"
                              : "text-muted-foreground",
                          )}
                        >
                          <BarChart3 className="size-4" />
                        </button>
                        {r.url !== null && (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            title={r.url}
                            aria-label={`Open the ranking page for ${r.keyword}`}
                            className="ml-1 inline-block rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
                          >
                            <Search className="size-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => void remove([r.id])}
                          aria-label={`Stop tracking ${r.keyword}`}
                          className="ml-1 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="size-4" />
                        </button>
                      </td>
                    </tr>

                    {expanded === r.id && (
                      <tr key={`${r.id}-chart`} className="border-b border-border">
                        <td colSpan={8} className="bg-muted/20 p-0">
                          <RankChart history={r.history} />
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Keywords Tracked: <span className="tabular">{rows.length}</span> · Each
        rank check is one SerpApi search, capped at 25 per click so a single
        press cannot drain the monthly allowance.
      </p>

      {/* ---------- Add Keywords ---------- */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Keywords</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={engine}
                onChange={(e) => {
                  setEngine(e.target.value);
                }}
                aria-label="Search engine"
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ENGINES.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>

              <label className="flex shrink-0 cursor-pointer flex-col items-center gap-1">
                <span
                  role="switch"
                  aria-checked={localized}
                  tabIndex={0}
                  onClick={() => {
                    setLocalized((v) => !v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLocalized((v) => !v);
                    }
                  }}
                  className={cn(
                    "flex h-6 w-11 items-center rounded-full p-0.5 transition-colors",
                    localized ? "bg-success" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "size-5 rounded-full bg-white shadow transition-transform",
                      localized && "translate-x-5",
                    )}
                  />
                </span>
                <span className="text-xs text-muted-foreground">Localized</span>
              </label>
            </div>

            {localized && (
              <Input
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                }}
                placeholder="Please type your location, e.g. Boston, Massachusetts"
                aria-label="Location"
              />
            )}

            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
              placeholder="Enter Keywords(One keyword per line)"
              aria-label="Keywords, one per line"
              rows={7}
            />

            <div className="space-y-1.5">
              <Label htmlFor="group-name">Group (optional)</Label>
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => {
                  setGroupName(e.target.value);
                }}
                placeholder="e.g. Recipes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                void submitKeywords(
                  text
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter((l) => l !== ""),
                )
              }
              disabled={busy === "adding" || text.trim() === ""}
            >
              {busy === "adding" ? "Adding…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Discovered keywords ---------- */}
      <Dialog open={foundOpen} onOpenChange={setFoundOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Keywords</DialogTitle>
          </DialogHeader>

          <p className="-mt-2 text-sm text-muted-foreground">
            We have found keywords you are already ranking for.
          </p>

          <div className="max-h-80 overflow-y-auto rounded border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Keywords found in Search Console</caption>
              <thead className="sticky top-0 bg-muted/60">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">Select</span>
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Keywords
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Position
                  </th>
                </tr>
              </thead>
              <tbody>
                {discovered.map((d) => (
                  <tr key={d.keyword} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={picked.has(d.keyword)}
                        onChange={() => {
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(d.keyword)) next.delete(d.keyword);
                            else next.add(d.keyword);
                            return next;
                          });
                        }}
                        aria-label={`Track ${d.keyword}`}
                        className="size-3.5 cursor-pointer accent-primary"
                      />
                    </td>
                    <td className="px-3 py-1.5">{d.keyword}</td>
                    <td className="tabular px-3 py-1.5 text-right text-muted-foreground">
                      {d.position}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFoundOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submitKeywords([...picked])}
              disabled={busy === "adding" || picked.size === 0}
            >
              Add {picked.size > 0 ? picked.size : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
