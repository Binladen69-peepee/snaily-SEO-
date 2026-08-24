"use client";

import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RotateCw,
  Search,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ISSUE_LABEL, type Issue, type IssueCode } from "@/lib/audit/types";
import { formatNumber } from "@/lib/keywords/format";

type AuditState = {
  id: string;
  status: "running" | "completed" | "failed";
  pagesCrawled: number;
  pagesFound: number;
  maxPages: number;
  healthScore: number;
  issueCounts: Partial<Record<IssueCode, number>>;
  totalIssues: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type PageRow = {
  id: string;
  url: string;
  path: string;
  status: number;
  title: string;
  metaDescription: string;
  h1: string[];
  wordCount: number;
  canonical: string;
  indexable: boolean;
  lastModified: string | null;
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinkCount: number;
  brokenLinks: string[];
  issues: Issue[];
  issueScore: number;
};

const SEVERITY_VARIANT = {
  high: "destructive",
  medium: "warning",
  low: "secondary",
} as const;

function healthColor(score: number) {
  if (score >= 80) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-destructive";
}

export function AuditView({
  projectId,
  projectName,
  projectUrl,
  initialAuditId,
}: {
  projectId: string | null;
  projectName: string | null;
  projectUrl: string | null;
  initialAuditId: string | null;
}) {
  const [audit, setAudit] = useState<AuditState | null>(null);
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [starting, setStarting] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [issue, setIssue] = useState("");
  const [sort, setSort] = useState("issueScore");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [pagesError, setPagesError] = useState<string | null>(null);

  const auditIdRef = useRef<string | null>(initialAuditId);
  const watchedRunningRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [q]);

  const loadAudit = useCallback(async (id: string) => {
    const res = await fetch(`/api/audits/${id}`);
    if (!res.ok) return null;
    const data = (await res.json()) as AuditState;
    setAudit(data);
    return data;
  }, []);

  const loadPages = useCallback(
    async (id: string) => {
      setLoadingPages(true);
      setPagesError(null);
      const params = new URLSearchParams({
        sort,
        dir,
        page: String(pageNum),
      });
      if (debouncedQ !== "") params.set("q", debouncedQ);
      if (issue !== "") params.set("issue", issue);

      try {
        const res = await fetch(`/api/audits/${id}/pages?${params.toString()}`);
        if (!res.ok) {
          setPagesError("Could not load pages for this audit.");
          setPages([]);
          setTotal(0);
        } else {
          const data = (await res.json()) as { pages: PageRow[]; total: number };
          setPages(data.pages);
          setTotal(data.total);
        }
      } catch {
        setPagesError("Could not load pages. Check your connection.");
      } finally {
        setLoadingPages(false);
      }
    },
    [debouncedQ, issue, sort, dir, pageNum],
  );

  // Initial load + poll while a crawl is running.
  useEffect(() => {
    const id = auditIdRef.current;
    if (id === null) return;

    let cancelled = false;

    async function tick() {
      const data = await loadAudit(id!);
      if (cancelled || !data) return;

      if (data.status === "running") {
        watchedRunningRef.current = true;
        setTimeout(() => void tick(), 1500);
      } else {
        if (watchedRunningRef.current) {
          watchedRunningRef.current = false;
          if (data.status === "failed") {
            toast.error(data.error ?? "The crawl could not complete.");
          } else if (data.status === "completed") {
            toast.success("Audit finished");
          }
        }
        void loadPages(id!);
      }
    }

    void tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAudit]);

  // Reload the table when filters change on a finished audit.
  useEffect(() => {
    const id = auditIdRef.current;
    if (id === null || audit?.status !== "completed") return;
    void loadPages(id);
  }, [loadPages, audit?.status]);

  async function startAudit() {
    if (projectId === null) return;
    setStarting(true);

    const res = await fetch("/api/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, maxPages: 100 }),
    });

    const data = (await res.json()) as { id?: string; error?: string };

    if (!res.ok) {
      toast.error(data.error ?? "Could not start the audit");
      setStarting(false);
      return;
    }

    auditIdRef.current = data.id ?? null;
    setPages(null);
    setPageNum(1);
    setStarting(false);
    toast.success("Crawl started");
    watchedRunningRef.current = true;

    if (data.id) {
      const id = data.id;
      const poll = async () => {
        const state = await loadAudit(id);
        if (state?.status === "running") {
          watchedRunningRef.current = true;
          setTimeout(() => void poll(), 1500);
        } else {
          if (watchedRunningRef.current) {
            watchedRunningRef.current = false;
            if (state?.status === "failed") {
              toast.error(state.error ?? "The crawl could not complete.");
            } else if (state?.status === "completed") {
              toast.success("Audit finished");
            }
          }
          void loadPages(id);
        }
      };
      void poll();
    }
  }

  function toggleSort(field: string) {
    if (field === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setDir(field === "url" || field === "title" ? "asc" : "desc");
    }
    setPageNum(1);
  }

  /* ---------------- No project ---------------- */
  if (projectId === null) {
    return (
      <EmptyState
        title="No project selected"
        description="Add a website first — audits run against the active project."
        action={{ href: "/projects", label: "Add a project" }}
      />
    );
  }

  /* ---------------- Loading existing audit ---------------- */
  if (audit === null && auditIdRef.current !== null) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading audit">
        <Skeleton className="h-10 w-40" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  /* ---------------- Never audited ---------------- */
  if (audit === null && auditIdRef.current === null) {
    return (
      <EmptyState
        icon={Search}
        title="No audit yet"
        description={`Crawl ${projectUrl?.replace(/^https?:\/\//, "") ?? projectName ?? "your site"} to find SEO issues.`}
      >
        <Button onClick={() => void startAudit()} disabled={starting}>
          {starting ? <Loader2 className="animate-spin" /> : <Play />}
          Start audit
        </Button>
      </EmptyState>
    );
  }

  const running = audit?.status === "running";
  const progress =
    audit !== null && audit.maxPages > 0
      ? Math.min(100, Math.round((audit.pagesCrawled / audit.maxPages) * 100))
      : 0;

  return (
    <div className="space-y-5">
      {/* ---------- Header / actions ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {audit !== null && (
            <>
              Last run {new Date(audit.startedAt).toLocaleString()}
              {audit.finishedAt !== null &&
                ` · ${String(audit.pagesCrawled)} pages crawled`}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {audit?.status === "completed" && auditIdRef.current !== null && (
            <Button variant="outline" asChild>
              <a href={`/api/audits/${auditIdRef.current}/export`} download>
                <Download />
                Export CSV
              </a>
            </Button>
          )}
          <Button onClick={() => void startAudit()} disabled={starting || running}>
          {starting || running ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RotateCw />
          )}
          {running ? "Crawling…" : "Rescan"}
          </Button>
        </div>
      </div>

      {/* ---------- Running ---------- */}
      {running && audit !== null && (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin" />
              Crawling {projectUrl?.replace(/^https?:\/\//, "")}
            </span>
            <span className="tabular text-muted-foreground">
              {audit.pagesCrawled} / {audit.maxPages} pages
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Crawl progress"
          >
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${String(Math.max(3, progress))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {audit.pagesFound} URLs discovered so far. You can leave this page —
            the crawl keeps running.
          </p>
        </div>
      )}

      {/* ---------- Failed ---------- */}
      {audit?.status === "failed" && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Audit failed</p>
            <p className="text-sm text-muted-foreground">
              {audit.error ?? "The crawl could not complete."}
            </p>
          </div>
        </div>
      )}

      {/* ---------- Summary ---------- */}
      {audit?.status === "completed" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Health score</p>
              <p
                className={`tabular mt-1 text-3xl font-semibold ${healthColor(audit.healthScore)}`}
              >
                {audit.healthScore}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${
                    audit.healthScore >= 80
                      ? "bg-success"
                      : audit.healthScore >= 50
                        ? "bg-warning"
                        : "bg-destructive"
                  }`}
                  style={{ width: `${String(audit.healthScore)}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Pages crawled</p>
              <p className="tabular mt-1 text-3xl font-semibold">
                {formatNumber(audit.pagesCrawled)}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Total issues</p>
              <p className="tabular mt-1 text-3xl font-semibold">
                {formatNumber(audit.totalIssues)}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Issue types</p>
              <p className="tabular mt-1 text-3xl font-semibold">
                {Object.keys(audit.issueCounts).length}
              </p>
            </div>
          </div>

          {/* Issue chips — click to filter */}
          {Object.keys(audit.issueCounts).length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setIssue("");
                  setPageNum(1);
                }}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  issue === ""
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border hover:bg-accent"
                }`}
              >
                All pages
              </button>

              {Object.entries(audit.issueCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([code, count]) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setIssue(code);
                      setPageNum(1);
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      issue === code
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {ISSUE_LABEL[code as IssueCode]}{" "}
                    <span className="tabular font-semibold">{count}</span>
                  </button>
                ))}
            </div>
          )}

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPageNum(1);
              }}
              placeholder="Search URL or title…"
              aria-label="Search pages"
              className="pl-9"
            />
          </div>

          {/* Pages table */}
          {loadingPages && pages === null ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : pagesError !== null ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 py-14 text-center"
            >
              <p className="font-medium text-destructive">Could not load pages</p>
              <p className="text-sm text-muted-foreground">{pagesError}</p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => {
                  if (auditIdRef.current) void loadPages(auditIdRef.current);
                }}
              >
                <RotateCw />
                Retry
              </Button>
            </div>
          ) : pages !== null && pages.length === 0 ? (
            <EmptyState
              className="py-14"
              title="No pages match"
              description="Try clearing the search or issue filter."
            />
          ) : (
            <>
              <div className="scroll-x rounded-lg border border-border">
                <table className="w-full min-w-[32rem] text-sm">
                  <caption className="sr-only">Crawled pages and their SEO issues</caption>
                  <thead className="bg-muted/50">
                    <tr>
                      <th scope="col" className="w-8 px-3 py-2.5" />
                      {[
                        { k: "url", l: "Page", a: "left" },
                        { k: "status", l: "Status", a: "right", hide: "md" },
                        { k: "title", l: "Title", a: "left", hide: "lg" },
                        { k: "wordCount", l: "Words", a: "right", hide: "md" },
                        { k: "issueScore", l: "Issues", a: "right" },
                      ].map((c) => (
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
                          className={`px-3 py-2.5 font-medium ${c.a === "right" ? "text-right" : "text-left"} ${
                            "hide" in c && c.hide === "md" ? "hidden md:table-cell" : ""
                          } ${
                            "hide" in c && c.hide === "lg" ? "hidden lg:table-cell" : ""
                          }`}
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

                  <tbody>
                    {pages?.map((p) => {
                      const open = expanded === p.id;
                      return (
                        <Fragment key={p.id}>
                          <tr className="border-t border-border hover:bg-accent/40">
                            <td className="px-3 py-2.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setExpanded(open ? null : p.id);
                                }}
                                aria-expanded={open}
                                aria-label={`Details for ${p.path}`}
                                className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {open ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </button>
                            </td>

                            <td className="max-w-xs px-3 py-2.5">
                              <span className="block truncate font-medium">
                                {p.path}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground lg:hidden">
                                {p.title === "" ? "— missing title —" : p.title}
                              </span>
                            </td>

                            <td className="tabular hidden px-3 py-2.5 text-right md:table-cell">
                              <span
                                className={
                                  p.status >= 400 || p.status === 0
                                    ? "text-destructive"
                                    : p.status >= 300
                                      ? "text-warning"
                                      : ""
                                }
                              >
                                {p.status === 0 ? "ERR" : p.status}
                              </span>
                            </td>

                            <td className="hidden max-w-xs px-3 py-2.5 lg:table-cell">
                              <span
                                className={`block truncate ${p.title === "" ? "text-destructive" : "text-muted-foreground"}`}
                              >
                                {p.title === "" ? "— missing —" : p.title}
                              </span>
                            </td>

                            <td className="tabular hidden px-3 py-2.5 text-right md:table-cell">
                              {formatNumber(p.wordCount)}
                            </td>

                            <td className="px-3 py-2.5 text-right">
                              {p.issues.length === 0 ? (
                                <Badge variant="success">Clean</Badge>
                              ) : (
                                <Badge
                                  variant={
                                    SEVERITY_VARIANT[
                                      p.issues.some((i) => i.severity === "high")
                                        ? "high"
                                        : p.issues.some((i) => i.severity === "medium")
                                          ? "medium"
                                          : "low"
                                    ]
                                  }
                                >
                                  {p.issues.length}
                                </Badge>
                              )}
                            </td>
                          </tr>

                          {open && (
                            <tr className="border-t border-border bg-muted/30">
                              <td colSpan={6} className="px-6 py-4">
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <dl className="space-y-2 text-sm">
                                    <div>
                                      <dt className="text-xs text-muted-foreground">URL</dt>
                                      <dd>
                                        <a
                                          href={p.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center gap-1 break-all hover:underline"
                                        >
                                          {p.url}
                                          <ExternalLink className="size-3 shrink-0" />
                                        </a>
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-muted-foreground">
                                        Meta description
                                      </dt>
                                      <dd className={p.metaDescription === "" ? "text-destructive" : ""}>
                                        {p.metaDescription || "— missing —"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-muted-foreground">H1</dt>
                                      <dd className={p.h1.length === 0 ? "text-destructive" : ""}>
                                        {p.h1.length === 0 ? "— missing —" : p.h1.join(" · ")}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-muted-foreground">Canonical</dt>
                                      <dd className="break-all">{p.canonical || "—"}</dd>
                                    </div>
                                  </dl>

                                  <div className="space-y-3 text-sm">
                                    <div className="flex flex-wrap gap-3">
                                      <span>
                                        <span className="text-xs text-muted-foreground">
                                          Indexable:{" "}
                                        </span>
                                        {p.indexable ? "Yes" : "No"}
                                      </span>
                                      <span>
                                        <span className="text-xs text-muted-foreground">
                                          Images:{" "}
                                        </span>
                                        {p.imagesTotal} ({p.imagesMissingAlt} without alt)
                                      </span>
                                      <span>
                                        <span className="text-xs text-muted-foreground">
                                          Internal links:{" "}
                                        </span>
                                        {p.internalLinkCount}
                                      </span>
                                      <span>
                                        <span className="text-xs text-muted-foreground">
                                          Modified:{" "}
                                        </span>
                                        {p.lastModified !== null
                                          ? new Date(p.lastModified).toLocaleDateString()
                                          : "—"}
                                      </span>
                                    </div>

                                    {p.issues.length > 0 && (
                                      <div>
                                        <p className="mb-1.5 text-xs text-muted-foreground">
                                          Issues
                                        </p>
                                        <ul className="space-y-1.5">
                                          {p.issues.map((i, idx) => (
                                            <li
                                              key={`${i.code}-${String(idx)}`}
                                              className="flex items-start gap-2"
                                            >
                                              <Badge variant={SEVERITY_VARIANT[i.severity]}>
                                                {i.severity}
                                              </Badge>
                                              <span>
                                                <span className="font-medium">
                                                  {ISSUE_LABEL[i.code]}
                                                </span>
                                                <span className="text-muted-foreground">
                                                  {" "}
                                                  — {i.detail}
                                                </span>
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {p.brokenLinks.length > 0 && (
                                      <div>
                                        <p className="mb-1 text-xs text-muted-foreground">
                                          Broken links
                                        </p>
                                        <ul className="space-y-0.5 text-xs text-destructive">
                                          {p.brokenLinks.slice(0, 5).map((l) => (
                                            <li key={l} className="break-all">
                                              {l}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {total > 50 && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Page {pageNum} of {Math.ceil(total / 50)} · {total} pages
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pageNum <= 1}
                      onClick={() => {
                        setPageNum((n) => n - 1);
                      }}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pageNum >= Math.ceil(total / 50)}
                      onClick={() => {
                        setPageNum((n) => n + 1);
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
