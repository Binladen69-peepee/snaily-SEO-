"use client";

import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Newspaper,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { STATUS_LABEL, type ArticleRow, type ArticleStatus } from "@/lib/articles";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [10, 25, 50];

function StatusPill({ status }: { status: ArticleStatus }) {
  const tone: Record<ArticleStatus, string> = {
    preparing: "text-warning",
    draft: "text-muted-foreground",
    in_progress: "text-primary",
    published: "text-success",
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", tone[status])}>
      {status === "preparing" ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-current"
        />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ArticlesView({
  initial,
  projectId,
  projectName,
}: {
  initial: ArticleRow[];
  projectId: string | null;
  projectName: string | null;
}) {
  const router = useRouter();
  const [articles, setArticles] = useState(initial);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const preparing = articles.some((a) => a.status === "preparing");
  const kicked = useRef(new Set<string>());

  /*
   * Research must run inside a live request (serverless freezes after respond).
   * Kick /prepare for any article still "Preparing" — including ones created
   * before the editor started calling it — then poll until status flips.
   */
  useEffect(() => {
    for (const a of articles) {
      if (a.status !== "preparing" || kicked.current.has(a.id)) continue;
      kicked.current.add(a.id);
      void fetch(`/api/articles/${a.id}/prepare`, { method: "POST" }).catch(
        () => undefined,
      );
    }
  }, [articles]);

  /*
   * While anything is "Preparing", poll for the research to land. Keyword
   * research crawls the whole first page of results, so it finishes seconds
   * to a minute after the article is created.
   */
  useEffect(() => {
    if (!preparing) return;

    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/articles${projectId === null ? "" : `?projectId=${projectId}`}`,
          );
          if (!res.ok) return;
          const data = (await res.json()) as { articles: ArticleRow[] };
          setArticles(data.articles);
        } catch {
          // A dropped poll is harmless; the next tick tries again.
        }
      })();
    }, 4000);

    return () => {
      clearInterval(timer);
    };
  }, [preparing, projectId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return articles;
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.keyword.toLowerCase().includes(needle),
    );
  }, [articles, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * perPage, current * perPage);

  async function create() {
    if (projectId === null) {
      toast.error("Create a project before writing articles");
      return;
    }
    if (title.trim() === "" || keyword.trim() === "") return;

    setCreating(true);
    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, keyword }),
      });
      const data = (await res.json()) as { id?: string; error?: string };

      if (!res.ok || data.id === undefined) {
        toast.error(data.error ?? "Could not create the article");
        return;
      }

      setOpen(false);
      setTitle("");
      setKeyword("");
      router.push(`/content-assistant/${data.id}`);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;

    setDeleting(id);
    try {
      const res = await fetch(`/api/articles/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not delete the article");
        return;
      }
      setArticles((prev) => prev.filter((a) => a.id !== id));
      toast.success("Article deleted");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* ---------- Header ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">Articles</h1>
          <span className="tabular rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
            {filtered.length} total
          </span>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search articles..."
              aria-label="Search articles"
              className="h-10 pl-9"
            />
          </div>

          <Button
            onClick={() => {
              setOpen(true);
            }}
            className="h-10 shrink-0"
          >
            <Plus />
            New Article
          </Button>
        </div>
      </div>

      {/* ---------- Table ---------- */}
      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">
              Articles {projectName === null ? "" : `for ${projectName}`}
            </caption>
            <thead className="border-b border-border bg-muted/40">
              <tr className="text-muted-foreground">
                <th scope="col" className="px-4 py-3 text-left font-normal">
                  Article title
                </th>
                <th scope="col" className="px-4 py-3 text-left font-normal">
                  Keyword
                </th>
                <th scope="col" className="px-4 py-3 text-left font-normal">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 text-left font-normal">
                  Last updated
                </th>
                <th scope="col" className="w-10 px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <Newspaper
                      className="mx-auto size-10 text-muted-foreground/50"
                      aria-hidden
                    />
                    <p className="mt-3 text-base font-semibold">
                      No articles found
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {query.trim() === ""
                        ? "Get started by creating your first article"
                        : "Nothing matches that search"}
                    </p>
                  </td>
                </tr>
              ) : (
                visible.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => {
                      router.push(`/content-assistant/${a.id}`);
                    }}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40"
                  >
                    <td className="max-w-[20rem] px-4 py-3">
                      <span className="block truncate font-semibold" title={a.title}>
                        {a.title}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block max-w-[14rem] truncate rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {a.keyword}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {new Date(a.updatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        aria-label={`Delete ${a.title}`}
                        disabled={deleting === a.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(a.id, a.title);
                        }}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- Footer ---------- */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Show:
          <select
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setPage(1);
            }}
            className="h-8 rounded border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous page"
            disabled={current <= 1}
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
            }}
            className="rounded border border-border p-1.5 transition-colors hover:bg-accent disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm text-muted-foreground">
            Page {current} of {pageCount}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={current >= pageCount}
            onClick={() => {
              setPage((p) => Math.min(pageCount, p + 1));
            }}
            className="rounded border border-border p-1.5 transition-colors hover:bg-accent disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* ---------- Create dialog ---------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Article</DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="article-title">Title</Label>
              <Input
                id="article-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                placeholder="Enter title"
                maxLength={200}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="article-keyword">Keyword</Label>
              <Input
                id="article-keyword"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                }}
                placeholder="Enter keyword"
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">
                We research this keyword in the background and build the
                editor&apos;s targets from the pages already ranking for it.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  creating || title.trim() === "" || keyword.trim() === ""
                }
              >
                {creating ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
