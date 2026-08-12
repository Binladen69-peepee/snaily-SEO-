"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ChangesPanel } from "@/components/intelligence/changes-panel";
import { PageDetail } from "@/components/intelligence/page-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/keywords/format";
import {
  priorityBand,
  type IntelReport,
  type PageIntel,
} from "@/lib/intelligence/types";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const PER_PAGE = 50;

type Sort = "priority" | "opportunity" | "health" | "issues" | "path" | "clicks";

function healthColor(score: number) {
  if (score >= 80) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-destructive";
}

function HealthBar({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-success" : score >= 50 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <span className={cn("tabular w-8 shrink-0 text-right text-sm font-medium", healthColor(score))}>
        {score}
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: React.ElementType;
  tone?: "success" | "warning" | "destructive" | "default";
}) {
  const valueClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className={cn("tabular text-3xl font-semibold leading-none", valueClass)}>
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function SpotlightCard({
  page,
  score,
  scoreName,
  reasons,
  onOpen,
}: {
  page: PageIntel;
  score: number;
  scoreName: string;
  reasons: string[];
  onOpen: () => void;
}) {
  const band = priorityBand(page.priority.score);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
      >
        <div className="flex flex-col items-center justify-center rounded-md bg-muted px-2 py-1 text-center">
          <span className="tabular text-lg font-bold leading-none">{score}</span>
          <span className="text-[10px] text-muted-foreground">{scoreName}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{page.path}</span>
            <Badge variant={band.variant} className="shrink-0 text-[10px]">
              {band.label}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {reasons.join(" · ")}
          </p>
        </div>
        <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

export function IntelligenceView({ report }: { report: IntelReport }) {
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [health, setHealth] = useState("");
  const [issueFilter, setIssueFilter] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [pageNum, setPageNum] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const attention = useMemo(
    () => report.pages.filter((p) => p.priority.score > 0).slice(0, 5),
    [report.pages],
  );

  const opportunities = useMemo(
    () =>
      [...report.pages]
        .filter((p) => p.opportunity.score > 0)
        .sort((a, b) => b.opportunity.score - a.opportunity.score)
        .slice(0, 5),
    [report.pages],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = report.pages.filter((p) => {
      if (
        needle !== "" &&
        !p.path.toLowerCase().includes(needle) &&
        !p.title.toLowerCase().includes(needle)
      )
        return false;

      if (priority === "critical" && p.priority.score < 70) return false;
      if (priority === "high" && (p.priority.score < 40 || p.priority.score >= 70))
        return false;
      if (priority === "medium" && (p.priority.score < 15 || p.priority.score >= 40))
        return false;
      if (priority === "none" && p.priority.score !== 0) return false;

      if (health === "poor" && p.health >= 50) return false;
      if (health === "fair" && (p.health < 50 || p.health >= 80)) return false;
      if (health === "good" && p.health < 80) return false;

      if (issueFilter === "any" && p.issues.length === 0) return false;
      if (issueFilter === "none" && p.issues.length > 0) return false;
      if (issueFilter === "many" && p.issues.length < 3) return false;
      if (issueFilter === "decaying" && p.decay.length === 0) return false;
      return true;
    });

    const factor = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (sort) {
        case "opportunity":
          return (a.opportunity.score - b.opportunity.score) * factor;
        case "health":
          return (a.health - b.health) * factor;
        case "issues":
          return (a.issues.length - b.issues.length) * factor;
        case "clicks":
          return (
            ((a.performance?.clicks ?? 0) - (b.performance?.clicks ?? 0)) * factor
          );
        case "path":
          return a.path.localeCompare(b.path) * factor;
        default:
          return (a.priority.score - b.priority.score) * factor;
      }
    });
    return rows;
  }, [report.pages, q, priority, health, issueFilter, sort, dir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(pageNum, totalPages);
  const visible = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const hasFilters = q !== "" || priority !== "" || health !== "" || issueFilter !== "";

  function toggleSort(field: Sort) {
    if (field === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setDir(field === "path" ? "asc" : "desc");
    }
    setPageNum(1);
  }

  function reset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPageNum(1);
    };
  }

  function focusPage(page: PageIntel) {
    setQ(page.path);
    setPriority("");
    setHealth("");
    setIssueFilter("");
    setPageNum(1);
    setExpanded(page.url);
  }

  function clearFilters() {
    setQ("");
    setPriority("");
    setHealth("");
    setIssueFilter("");
    setPageNum(1);
  }

  const { summary } = report;

  return (
    <div className="space-y-6">
      {/* ---------- Explain the scores (one-liner legend) ---------- */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Zap className="size-3.5 text-destructive" />
          <strong className="text-foreground">Priority</strong> — how urgently Google needs this fixed
        </span>
        <span className="text-border">·</span>
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-success" />
          <strong className="text-foreground">Opportunity</strong> — biggest SEO gain per unit of effort
        </span>
        <span className="text-border">·</span>
        <span className="flex items-center gap-1.5">
          <TrendingUp className="size-3.5 text-primary" />
          <strong className="text-foreground">Health</strong> — issue-free score for this page (100 = clean)
        </span>
      </div>

      {/* ---------- Summary ---------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={AlertTriangle}
          label="Need attention"
          value={summary.needsAttention}
          hint="Priority 40 or higher — fix first"
          tone={summary.needsAttention > 0 ? "destructive" : "success"}
        />
        <SummaryCard
          icon={Zap}
          label="Quick fixes"
          value={summary.quickWins}
          hint="Fixable in minutes (title, meta, alt text)"
          tone={summary.quickWins > 0 ? "warning" : "success"}
        />
        <SummaryCard
          icon={TrendingDown}
          label="Decaying"
          value={summary.decayingPages}
          hint="Content shrank or issues grew since last crawl"
          tone={summary.decayingPages > 0 ? "warning" : "default"}
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Clean pages"
          value={`${String(summary.cleanPages)}/${String(summary.totalPages)}`}
          hint="No issues found on these pages"
          tone={summary.cleanPages === summary.totalPages ? "success" : "default"}
        />
      </div>

      {/* ---------- Spotlights ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-start gap-2">
            <Zap className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <h2 className="font-semibold">Fix these first</h2>
              <p className="text-xs text-muted-foreground">
                Worst issues on your most important pages
              </p>
            </div>
          </div>
          {attention.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-success">
              <CheckCircle2 className="size-4" />
              No page needs urgent attention right now.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {attention.map((p) => (
                <SpotlightCard
                  key={p.url}
                  page={p}
                  score={p.priority.score}
                  scoreName="priority"
                  reasons={p.priority.reasons.slice(0, 3).map((r) => r.label)}
                  onOpen={() => {
                    focusPage(p);
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-start gap-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-success" />
            <div>
              <h2 className="font-semibold">Highest opportunity</h2>
              <p className="text-xs text-muted-foreground">
                Most SEO gain for the least work
              </p>
            </div>
          </div>
          {opportunities.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-success">
              <CheckCircle2 className="size-4" />
              Every page is clean — nothing to improve.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {opportunities.map((p) => (
                <SpotlightCard
                  key={p.url}
                  page={p}
                  score={p.opportunity.score}
                  scoreName="opp."
                  reasons={p.opportunity.reasons.slice(0, 3).map((r) => r.label)}
                  onOpen={() => {
                    focusPage(p);
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ---------- Changes ---------- */}
      {report.comparison ? (
        <ChangesPanel comparison={report.comparison} />
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          <RefreshCw className="mt-0.5 size-4 shrink-0" />
          <span>
            This is your first completed audit. Run another crawl to start tracking
            what improves or regresses between scans.
          </span>
          <Button variant="outline" size="sm" asChild className="ml-auto shrink-0">
            <Link href="/audit">Crawl now</Link>
          </Button>
        </div>
      )}

      {/* ---------- GSC nudge when no performance data ---------- */}
      {!summary.hasPerformance && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
          <TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <strong>Connect Google Search Console</strong> to see real clicks and
            impressions per page, and to make Priority scores more accurate.
          </span>
          <Button variant="outline" size="sm" asChild className="ml-auto shrink-0">
            <Link href="/integrations">Connect</Link>
          </Button>
        </div>
      )}

      {/* ---------- Filters ---------- */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filter pages</span>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                reset(setQ)(e.target.value);
              }}
              placeholder="Search path or title…"
              aria-label="Search pages"
              className="pl-9"
            />
          </div>

          <select
            aria-label="Filter by priority"
            className={SELECT_CLASS}
            value={priority}
            onChange={(e) => {
              reset(setPriority)(e.target.value);
            }}
          >
            <option value="">Any priority</option>
            <option value="critical">Critical (70+)</option>
            <option value="high">High (40–69)</option>
            <option value="medium">Medium (15–39)</option>
            <option value="none">No priority (0)</option>
          </select>

          <select
            aria-label="Filter by health"
            className={SELECT_CLASS}
            value={health}
            onChange={(e) => {
              reset(setHealth)(e.target.value);
            }}
          >
            <option value="">Any health</option>
            <option value="good">Good (80–100)</option>
            <option value="fair">Fair (50–79)</option>
            <option value="poor">Poor (0–49)</option>
          </select>

          <select
            aria-label="Filter by issues"
            className={SELECT_CLASS}
            value={issueFilter}
            onChange={(e) => {
              reset(setIssueFilter)(e.target.value);
            }}
          >
            <option value="">Any issue count</option>
            <option value="any">Has issues</option>
            <option value="many">3 or more issues</option>
            <option value="none">No issues</option>
            <option value="decaying">Decaying</option>
          </select>
        </div>
      </div>

      {/* ---------- Table ---------- */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center">
          <p className="font-medium">No pages match your filters</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Audited pages ranked by priority, with health and opportunity scores
              </caption>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th scope="col" className="w-8 px-3 py-2.5" />
                  {(
                    [
                      { k: "path", l: "Page", a: "left" },
                      { k: "priority", l: "Priority", a: "right" },
                      { k: "opportunity", l: "Opportunity", a: "right" },
                      { k: "health", l: "Health", a: "right" },
                      { k: "issues", l: "Issues", a: "right" },
                      ...(report.summary.hasPerformance
                        ? ([{ k: "clicks", l: "Clicks (28d)", a: "right" }] as const)
                        : []),
                    ] as const
                  ).map((c) => (
                    <th
                      key={c.k}
                      scope="col"
                      aria-sort={
                        sort === c.k
                          ? dir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      className={`px-3 py-2.5 font-medium ${c.a === "right" ? "text-right" : "text-left"}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          toggleSort(c.k);
                        }}
                        className={
                          sort === c.k
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }
                      >
                        {c.l}
                        {sort === c.k ? (dir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {visible.map((p) => {
                  const open = expanded === p.url;
                  const band = priorityBand(p.priority.score);

                  if (open) {
                    return (
                      <tr key={p.url}>
                        <td colSpan={report.summary.hasPerformance ? 7 : 6} className="p-0">
                          <div className="flex items-center gap-2 bg-accent/40 px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => {
                                setExpanded(null);
                              }}
                              aria-expanded
                              aria-label={`Hide details for ${p.path}`}
                              className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <ChevronDown className="size-4" />
                            </button>
                            <span className="truncate font-medium">{p.path}</span>
                            <Badge variant={band.variant} className="shrink-0">
                              {band.label}
                            </Badge>
                            {p.issues.length > 0 && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                {p.issues.length} issue{p.issues.length === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                          <div className="bg-muted/20 px-6 py-5">
                            <PageDetail page={p} />
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={p.url}
                      className="group hover:bg-accent/30 transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setExpanded(p.url);
                          }}
                          aria-expanded={false}
                          aria-label={`Show details for ${p.path}`}
                          className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight className="size-4" />
                        </button>
                      </td>

                      <td className="max-w-xs px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{p.path}</span>
                          {p.decay.length > 0 && (
                            <TrendingDown
                              className="size-3.5 shrink-0 text-warning"
                              aria-label="Decaying"
                            />
                          )}
                          {p.isNew && (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              New
                            </Badge>
                          )}
                        </div>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.title === "" ? (
                            <span className="italic">No title tag</span>
                          ) : (
                            p.title
                          )}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="tabular font-semibold">
                            {p.priority.score}
                          </span>
                          <Badge variant={band.variant}>{band.label}</Badge>
                        </div>
                      </td>

                      <td className="tabular px-3 py-2.5 text-right font-medium">
                        {p.opportunity.score > 0 ? (
                          <span className="text-success">{p.opportunity.score}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 text-right">
                        <HealthBar score={p.health} />
                      </td>

                      <td className="tabular px-3 py-2.5 text-right">
                        {p.issues.length === 0 ? (
                          <Badge variant="success">Clean</Badge>
                        ) : (
                          <span
                            className={
                              p.issues.length >= 3 ? "text-destructive font-medium" : ""
                            }
                          >
                            {p.issues.length}
                          </span>
                        )}
                      </td>

                      {report.summary.hasPerformance && (
                        <td className="tabular px-3 py-2.5 text-right">
                          {p.performance ? (
                            <span
                              title={`${String(p.performance.impressions)} impressions · pos. ${String(p.performance.position)}`}
                              className="cursor-help"
                            >
                              {formatNumber(p.performance.clicks)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {filtered.length === report.pages.length
                ? `${String(filtered.length)} pages`
                : `${String(filtered.length)} of ${String(report.pages.length)} pages`}
              {totalPages > 1 &&
                ` · page ${String(current)} of ${String(totalPages)}`}
            </p>

            <div className="flex gap-2">
              {totalPages > 1 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={current <= 1}
                    onClick={() => {
                      setPageNum(current - 1);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={current >= totalPages}
                    onClick={() => {
                      setPageNum(current + 1);
                    }}
                  >
                    Next
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link href="/audit">
                  <RefreshCw className="size-3.5" />
                  Rescan site
                </Link>
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
