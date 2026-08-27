"use client";

import {
  ExternalLink,
  FileText,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  TrendingDown,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetup } from "@/components/setup/setup-provider";
import type { ScoredPost } from "@/lib/content/update-queue";
import type { ConnectionStatus } from "@/lib/wordpress/sync";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/pagination";
import { useDebounced } from "@/lib/use-debounced";
import { SearchableSelect } from "@/components/ui/searchable-select";

type SortId = "priority" | "modified" | "clicks" | "words-asc" | "seo-asc" | "title";

const SORTS: { id: SortId; label: string }[] = [
  { id: "priority", label: "Needs updating first" },
  { id: "clicks", label: "Most traffic" },
  { id: "modified", label: "Recently modified" },
  { id: "words-asc", label: "Thinnest first" },
  { id: "seo-asc", label: "Weakest SEO first" },
  { id: "title", label: "Title A–Z" },
];

/** Yoast and Rank Math both score 0–100 on the same rough bands. */
function scoreTone(score: number): string {
  if (score >= 70) return "text-success";
  if (score >= 40) return "text-warning";
  return "text-destructive";
}

function priorityTone(score: number): string {
  if (score >= 50) return "bg-destructive/10 text-destructive";
  if (score >= 25) return "bg-warning/15 text-warning";
  if (score > 0) return "bg-muted text-muted-foreground";
  return "bg-success/10 text-success";
}

function fmtDate(iso: string | null): string {
  if (iso === null) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/**
 * Posts synced from WordPress, ranked by how badly they need attention.
 *
 * The ranking is the point. A list of 639 posts is not actionable; the same
 * list ordered by a score built from real traffic movement, length and staleness
 * is the "what should I work on" answer both Occasio and Clariti sell.
 */
export function PostsView({
  projectId,
  projectName,
  status,
  posts,
  missingPerformance,
}: {
  projectId: string;
  projectName: string;
  status: ConnectionStatus | null;
  posts: ScoredPost[];
  missingPerformance: boolean;
}) {
  const router = useRouter();
  const { snapshot, openSetup, openWpGate, refreshSnapshot } = useSetup();
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "post" | "page">("all");
  const [state, setState] = useState<"all" | "publish" | "draft">("all");
  const [sort, setSort] = useState<SortId>("priority");
  const [onlyNeedy, setOnlyNeedy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  /*
   * The filter runs over every synced post - six hundred on this site - and
   * re-renders the table. Doing that per keystroke made the search box feel
   * like it was resisting the typist, so the input stays instant and only the
   * value the filter reads lags behind.
   */
  const debouncedQuery = useDebounced(query, 250);

  async function sync(full: boolean) {
    setSyncing(true);
    try {
      const res = await fetch("/api/wordpress/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, full }),
      });
      const data = (await res.json()) as {
        imported?: number;
        truncated?: boolean;
        error?: string;
        setupIncomplete?: boolean;
        reason?: "not_configured" | "connection_lost" | "sync_failed";
      };
      if (!res.ok) {
        if (data.setupIncomplete === true || res.status === 409) {
          console.error("[wordpress sync]", data.error);
          await refreshSnapshot();
          openWpGate(
            data.reason === "connection_lost"
              ? "connection_lost"
              : "not_configured",
          );
          return;
        }
        toast.error(data.error ?? "Sync failed");
        return;
      }
      toast.success(
        data.imported === 0
          ? "Already up to date"
          : `Synced ${String(data.imported ?? 0)} post${data.imported === 1 ? "" : "s"}`,
      );
      if (data.truncated === true) {
        toast.warning("More posts remain — run the sync again to continue.");
      }
      router.refresh();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSyncing(false);
    }
  }

  const visible = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const rows = posts.filter((p) => {
      if (type !== "all" && p.type !== type) return false;
      if (state !== "all" && p.status !== state) return false;
      if (onlyNeedy && p.score === 0) return false;
      if (q === "") return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.focusKeyword.toLowerCase().includes(q) ||
        p.categories.some((c) => c.toLowerCase().includes(q))
      );
    });

    return [...rows].sort((a, b) => {
      switch (sort) {
        case "clicks":
          return (b.performance?.clicks ?? 0) - (a.performance?.clicks ?? 0);
        case "words-asc":
          return a.wordCount - b.wordCount;
        case "seo-asc":
          // Unscored posts sort last: a missing score is not a bad score.
          return (a.seoScore ?? 999) - (b.seoScore ?? 999);
        case "title":
          return a.title.localeCompare(b.title);
        case "modified":
          return (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "");
        default:
          return b.score - a.score || (b.performance?.impressions ?? 0) - (a.performance?.impressions ?? 0);
      }
    });
  }, [posts, debouncedQuery, type, state, sort, onlyNeedy]);

  /*
   * Six hundred rows in the DOM is the single biggest cost on this screen, and
   * nobody reads past the first screenful. The filter still runs over
   * everything - the counts have to be true - but only a page of it renders.
   */
  const PER_PAGE = 25;
  const totalPages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const current = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => visible.slice((current - 1) * PER_PAGE, current * PER_PAGE),
    [visible, current],
  );

  // A filter change can leave you on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, type, state, sort, onlyNeedy]);

  const stats = useMemo(() => {
    const clicks = posts.reduce((s, p) => s + (p.performance?.clicks ?? 0), 0);
    return {
      total: posts.length,
      needy: posts.filter((p) => p.score >= 25).length,
      decaying: posts.filter((p) =>
        p.reasons.some((r) => r.label.startsWith("Traffic")),
      ).length,
      clicks,
    };
  }, [posts]);

  const health =
    snapshot?.projectId === projectId
      ? snapshot.wordpress.health
      : status === null
        ? "not_configured"
        : status.lastError !== null && status.lastError !== ""
          ? "connection_lost"
          : "connected";

  /* ------------------------------------------------------ not connected */

  if (status === null || health === "not_configured") {
    return (
      <div className="space-y-5">
        <Heading projectName={projectName} />
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <Plug className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 font-medium">WordPress setup is incomplete</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Install and connect the Snaily SEO connector on {projectName} to
            pull posts in. Keyword research and audits still work without it.
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              openSetup();
            }}
          >
            <Plug />
            Finish Setup
          </Button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ connected */

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Heading projectName={projectName} />
        <Button variant="outline" onClick={() => void sync(false)} disabled={syncing}>
          {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Sync now
        </Button>
      </div>

      {/* ---- connection banner ---- */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border bg-card px-4 py-3 text-xs",
          health === "connection_lost"
            ? "border-destructive/40"
            : "border-border",
        )}
      >
        {health === "connection_lost" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
            <span className="size-2 rounded-full bg-destructive" aria-hidden />
            Connection lost
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-medium text-success">
            <span className="size-2 rounded-full bg-success" aria-hidden />
            Connected
          </span>
        )}
        <span className="truncate text-muted-foreground">{status.siteUrl}</span>
        <span className="text-muted-foreground">SEO plugin: {status.seoPlugin}</span>
        <span className="text-muted-foreground">
          Last synced{" "}
          {status.lastSyncedAt === null
            ? "never"
            : new Date(status.lastSyncedAt).toLocaleString()}
        </span>
        {health === "connection_lost" ? (
          <span className="text-destructive">
            Your WordPress connector is no longer active.
          </span>
        ) : null}
        {health === "connection_lost" ? (
          <Button
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => {
              openSetup({ reason: "connection_lost" });
            }}
          >
            Reconnect
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => {
              openSetup();
            }}
            className="ml-auto shrink-0 text-primary hover:underline"
          >
            Manage
          </button>
        )}
      </div>

      {missingPerformance && posts.length > 0 && (
        <p className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-xs text-muted-foreground">
          <span className="font-medium text-warning">No Search Console data yet.</span>{" "}
          Priorities are based on length, staleness and SEO score only — traffic
          decay and click-through signals need Search Console connected and synced.
        </p>
      )}

      {/* ---- stats ---- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Posts & pages" value={String(stats.total)} hint="Synced from WordPress" />
        <Stat
          label="Need updating"
          value={String(stats.needy)}
          hint="Priority 25 or above"
          tone={stats.needy > 0 ? "warn" : undefined}
        />
        <Stat
          label="Losing traffic"
          value={String(stats.decaying)}
          hint="Down against the prior 28 days"
          tone={stats.decaying > 0 ? "bad" : undefined}
        />
        <Stat
          label="Clicks (28 days)"
          value={stats.clicks.toLocaleString("en-US")}
          hint="From Search Console"
        />
      </div>

      {/* ---- filters ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder="Search titles, keywords, categories…"
            aria-label="Search posts"
            className="h-9 pl-8"
          />
        </div>

        <button
          type="button"
          onClick={() => { setOnlyNeedy((v) => !v); }}
          aria-pressed={onlyNeedy}
          className={cn(
            "h-9 rounded-md border px-3 text-sm transition-colors",
            onlyNeedy
              ? "border-primary/40 bg-primary/10 font-medium text-primary"
              : "border-input text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          Needs attention
        </button>

        {/*
          The app's own select, not the browser's. A native dropdown renders
          differently on every platform and ignores the theme, which is why
          these three looked like controls borrowed from another product.
        */}
        <SearchableSelect
          className="w-[8.5rem]"
          aria-label="Filter by type"
          value={type}
          options={[
            { value: "all", label: "All types" },
            { value: "post", label: "Posts" },
            { value: "page", label: "Pages" },
          ]}
          onChange={(next) => {
            setType(next as typeof type);
          }}
        />

        <SearchableSelect
          className="w-[9.5rem]"
          aria-label="Filter by status"
          value={state}
          options={[
            { value: "all", label: "All statuses" },
            { value: "publish", label: "Published" },
            { value: "draft", label: "Drafts" },
          ]}
          onChange={(next) => {
            setState(next as typeof state);
          }}
        />

        <SearchableSelect
          className="w-[13rem]"
          aria-label="Sort posts"
          value={sort}
          options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
          onChange={(next) => {
            setSort(next as SortId);
          }}
        />

        <span className="ml-auto text-xs text-muted-foreground">
          {visible.length} of {posts.length}
        </span>
      </div>

      {/* ---- list ---- */}
      {posts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 font-medium">Nothing synced yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The site is connected — run a sync to pull your posts in.
          </p>
          <Button className="mt-4" onClick={() => void sync(true)} disabled={syncing}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Run first sync
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          Nothing matches those filters.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="scroll-x">
            <table className="w-full min-w-232 text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Post</th>
                  <th className="px-4 py-2.5 text-right font-medium">Priority</th>
                  <th className="px-4 py-2.5 text-right font-medium">Clicks</th>
                  <th className="px-4 py-2.5 text-right font-medium">Change</th>
                  <th className="px-4 py-2.5 text-right font-medium">Position</th>
                  <th className="px-4 py-2.5 text-right font-medium">Words</th>
                  <th className="px-4 py-2.5 text-right font-medium">SEO</th>
                  <th className="px-4 py-2.5 font-medium">Modified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.map((p) => {
                  const perf = p.performance;
                  const expanded = openId === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr
                        className={cn("cursor-pointer hover:bg-accent/30", expanded && "bg-accent/20")}
                        onClick={() => { setOpenId(expanded ? null : p.id); }}
                      >
                        <td className="max-w-sm px-4 py-2.5">
                          <span className="block truncate font-medium">
                            {p.title || "(no title)"}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {p.reasons.length > 0
                              ? p.reasons[0]!.label
                              : p.focusKeyword !== ""
                                ? `Focus: ${p.focusKeyword}`
                                : p.type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span
                            className={cn(
                              "tabular inline-block rounded px-2 py-0.5 text-xs font-medium",
                              priorityTone(p.score),
                            )}
                          >
                            {p.score}
                          </span>
                        </td>
                        <td className="tabular px-4 py-2.5 text-right">
                          {perf === null ? <span className="text-muted-foreground">—</span> : perf.clicks.toLocaleString("en-US")}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right">
                          {perf?.changePct == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={cn(
                                "inline-flex items-center gap-0.5",
                                perf.changePct < -10 ? "text-destructive" : perf.changePct > 10 ? "text-success" : "text-muted-foreground",
                              )}
                            >
                              {perf.changePct < -10 && <TrendingDown className="size-3" aria-hidden />}
                              {perf.changePct > 0 ? "+" : ""}
                              {Math.round(perf.changePct)}%
                            </span>
                          )}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right">
                          {perf === null || perf.position === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            (Math.round(perf.position * 10) / 10).toFixed(1)
                          )}
                        </td>
                        <td className={cn("tabular px-4 py-2.5 text-right", p.wordCount < 300 && "text-warning")}>
                          {p.wordCount.toLocaleString("en-US")}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right">
                          {p.seoScore === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={scoreTone(p.seoScore)}>{p.seoScore}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {fmtDate(p.modifiedAt)}
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="bg-accent/10">
                          <td colSpan={8} className="px-4 py-3">
                            {p.reasons.length === 0 ? (
                              <p className="text-xs text-success">
                                Nothing flagged — this post is performing and current.
                              </p>
                            ) : (
                              <>
                                <p className="text-xs font-medium">
                                  Why this scores {p.score}
                                </p>
                                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                                  {p.reasons.map((r) => (
                                    <li key={r.label} className="flex gap-2 text-[11px]">
                                      <span className="tabular shrink-0 rounded bg-muted px-1.5 font-medium">
                                        +{r.points}
                                      </span>
                                      <span>
                                        <span className="font-medium">{r.label}</span>
                                        <span className="text-muted-foreground"> — {r.detail}</span>
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                            <a
                              href={p.link}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              onClick={(e) => { e.stopPropagation(); }}
                            >
                              Open the post
                              <ExternalLink className="size-3" aria-hidden />
                            </a>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border px-4 py-2.5">
            <Pagination
              page={current}
              totalPages={totalPages}
              total={visible.length}
              perPage={PER_PAGE}
              onPage={setPage}
              label="posts"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Heading({ projectName }: { projectName: string }) {
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight">Content Library</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What to update on {projectName}, ranked by evidence.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <p
        className={cn(
          "tabular text-2xl font-semibold leading-none",
          tone === "warn" && "text-warning",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-xs font-medium">{label}</p>
      <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
