"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { RichEditor } from "@/components/articles/rich-editor";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ARTICLE_STATUSES,
  markdownLinks,
  markdownWords,
  STATUS_LABEL,
  type ArticleBrief,
  type ArticleStatus,
} from "@/lib/articles";
import {
  analyseTitle,
  checkTerms,
  optimizationScore,
  TITLE_IDEAL_MAX,
  TITLE_IDEAL_MIN,
  TITLE_MAX,
} from "@/lib/content-score";
import {
  difficultyBand,
  formatCpc,
  formatVolume,
  qualityBand,
} from "@/lib/keywords/format";
import { looksLikeHtml, markdownToHtml, toEditorHtml } from "@/lib/markdown";
import { cn } from "@/lib/utils";

type SidebarTab = "overview" | "keywords" | "questions" | "serp" | "meta";

const TABS: { id: SidebarTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "keywords", label: "Keywords" },
  { id: "questions", label: "Questions" },
  { id: "serp", label: "SERP" },
  { id: "meta", label: "Meta" },
];

function StatBar({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) {
  const pct = target === 0 ? 0 : Math.min(100, (value / target) * 100);
  const met = target > 0 && value >= target;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">{label}</span>
        <span
          className={cn(
            "tabular rounded-md px-1.5 py-0.5 text-xs font-medium",
            met ? "bg-success/12 text-success" : "bg-primary/10 text-primary",
          )}
        >
          {value.toLocaleString("en-US")} / {target.toLocaleString("en-US")}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            met ? "bg-success" : "bg-primary",
          )}
          style={{ width: `${String(pct)}%` }}
        />
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold"
      >
        {title}
        <ChevronDown
          className={cn("size-4 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

export function ArticleEditor({
  article,
  brief: initialBrief,
  briefError: initialBriefError,
  aiEnabled,
}: {
  article: {
    id: string;
    title: string;
    keyword: string;
    status: ArticleStatus;
    content: string;
  };
  brief: ArticleBrief | null;
  briefError: string | null;
  aiEnabled: boolean;
}) {
  const [title, setTitle] = useState(article.title);
  const [content, setContent] = useState(article.content);
  const [status, setStatus] = useState<ArticleStatus>(
    article.status === "preparing" ? "draft" : article.status,
  );
  const [brief, setBrief] = useState<ArticleBrief | null>(initialBrief);
  const [briefError, setBriefError] = useState<string | null>(initialBriefError);
  const [researching, setResearching] = useState(
    initialBrief === null && initialBriefError === null,
  );
  const [tab, setTab] = useState<SidebarTab>("overview");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("saved");
  const [wide, setWide] = useState(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [generating, setGenerating] = useState(false);
  const [blocks, setBlocks] = useState<string[]>([]);

  const words = markdownWords(content);
  const links = markdownLinks(content);
  const targetWords = brief?.targetWords ?? 0;
  const targetLinks = brief?.targetLinks ?? 0;

  const termStatuses = useMemo(
    () => checkTerms(`${title}\n${content}`, brief?.terms ?? []),
    [title, content, brief],
  );
  const coveredTerms = termStatuses.filter((t) => t.done).length;

  /** Headline optimisation score — 75% weighted coverage reads as 100%. */
  const optimization = useMemo(
    () => optimizationScore(termStatuses),
    [termStatuses],
  );

  const titleAnalysis = useMemo(
    () =>
      analyseTitle(
        title,
        article.keyword,
        (brief?.terms ?? [])
          .filter((t) => t.size === 1)
          .map((t) => t.term)
          .slice(0, 10),
        brief?.terms ?? [],
      ),
    [title, article.keyword, brief],
  );

  const save = useCallback(
    async (patch: {
      title?: string;
      content?: string;
      status?: ArticleStatus;
    }) => {
      setSaving("saving");
      try {
        const res = await fetch(`/api/articles/${article.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        setSaving(res.ok ? "saved" : "idle");
        if (!res.ok) toast.error("Could not save — your text is still here.");
      } catch {
        setSaving("idle");
        toast.error("Could not reach the server — your text is still here.");
      }
    },
    [article.id],
  );

  /**
   * Kick off (or retry) keyword research. The create route deliberately does
   * not start this — detached work dies on serverless — so the live editor
   * request must own it.
   */
  const runPrepare = useCallback(
    async (force = false) => {
      if (!force && brief !== null) return;

      setResearching(true);
      setBriefError(null);

      try {
        const res = await fetch(`/api/articles/${article.id}/prepare`, {
          method: "POST",
        });
        const data = (await res.json()) as {
          brief?: ArticleBrief | null;
          briefError?: string | null;
          error?: string;
        };

        if (!res.ok) {
          setBriefError(data.error ?? "Could not research this keyword.");
          setStatus((s) => (s === "preparing" ? "draft" : s));
          toast.error(data.error ?? "Research failed");
          return;
        }

        if (data.brief) {
          setBrief(data.brief);
          setBriefError(null);
          setStatus((s) => (s === "preparing" ? "draft" : s));
        } else {
          setBriefError(
            data.briefError ?? "Research finished with no usable data.",
          );
          setStatus((s) => (s === "preparing" ? "draft" : s));
        }
      } catch {
        setBriefError("Could not reach the server to research this keyword.");
        toast.error("Research request failed — try again.");
      } finally {
        setResearching(false);
      }
    },
    [article.id, brief],
  );

  // Start research once on open when the brief is missing.
  const prepareStarted = useRef(false);
  useEffect(() => {
    if (prepareStarted.current) return;
    if (initialBrief !== null || initialBriefError !== null) return;
    prepareStarted.current = true;
    void runPrepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional once-on-mount
  }, []);

  // Debounced autosave. Skip the first run so opening does not rewrite.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaving("saving");
    const timer = setTimeout(() => {
      void save({ title, content });
    }, 900);
    return () => {
      clearTimeout(timer);
    };
  }, [title, content, save]);

  async function runAi() {
    if (instruction.trim() === "") return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/articles/${article.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = (await res.json()) as { blocks?: string[]; error?: string };

      if (!res.ok || !data.blocks) {
        toast.error(data.error ?? "Could not generate content");
        return;
      }

      setBlocks(data.blocks);
      setAiOpen(false);
      setInstruction("");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setGenerating(false);
    }
  }

  function blockToHtml(block: string): string {
    return toEditorHtml(block);
  }

  function accept(index: number) {
    const block = blocks[index];
    if (block === undefined) return;
    const html = blockToHtml(block);
    setContent((c) => {
      const cur = c.trim();
      if (cur === "") return html;
      return looksLikeHtml(cur) ? `${cur}${html}` : `${toEditorHtml(cur)}${html}`;
    });
    setBlocks((b) => b.filter((_, i) => i !== index));
  }

  function acceptAll() {
    const joined = blocks.map(blockToHtml).join("");
    setContent((c) => {
      const cur = c.trim();
      if (cur === "") return joined;
      return looksLikeHtml(cur)
        ? `${cur}${joined}`
        : `${toEditorHtml(cur)}${joined}`;
    });
    setBlocks([]);
  }

  function exportArticle() {
    const htmlBody = toEditorHtml(content);
    const doc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${title
      .replace(/</g, "")
      .replace(/&/g, "&amp;")}</title></head><body>
<h1>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h1>
${htmlBody}
</body></html>`;
    const url = URL.createObjectURL(
      new Blob([doc], { type: "text/html;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "article"}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported as HTML");
  }

  return (
    <div className="-m-4 flex min-h-[calc(100svh-55px)] flex-col bg-background sm:-m-6 xl:h-[calc(100svh-55px)] xl:overflow-hidden">
      {/* ---------- Toolbar ---------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2.5 shadow-sm">
        <Link
          href="/content-assistant"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Articles
        </Link>

        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />

        <p className="hidden min-w-0 truncate text-sm font-medium sm:block sm:max-w-[14rem]">
          {title.trim() || "Untitled article"}
        </p>

        <div className="flex-1" />

        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs",
            saving === "saved" ? "text-success" : "text-muted-foreground",
          )}
        >
          {saving === "saving" ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
          )}
          {saving === "saving" ? "Saving…" : "Saved"}
        </span>

        <button
          type="button"
          onClick={exportArticle}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
        >
          <Download className="size-3.5" aria-hidden />
          Export
        </button>

        <button
          type="button"
          onClick={() => {
            setWide((w) => !w);
          }}
          aria-label={wide ? "Show research panel" : "Hide research panel"}
          className="rounded-md border border-border bg-background p-1.5 transition-colors hover:bg-accent"
        >
          {wide ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Maximize2 className="size-3.5" />
          )}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* ================= Editor ================= */}
        <div className="relative min-w-0 flex-1 xl:overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
            {/*
              Content Optimization Score. Weighted by term importance, and
              topping out once ~75% of the weighted target set is covered —
              chasing the last quarter pushes writers into keyword stuffing.
            */}
            {termStatuses.length > 0 && (
              <div className="mb-5 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        'tabular text-4xl font-bold leading-none',
                        qualityBand(optimization.percent).className,
                      )}
                    >
                      {optimization.percent}
                    </span>
                    <span className="text-lg font-semibold text-muted-foreground">%</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        Content Optimization Score
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {optimization.used} of {optimization.total} terms ·{' '}
                        {Math.round(optimization.weightedCoverage * 100)}% weighted
                      </p>
                    </div>

                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          optimization.complete ? 'bg-success' : 'bg-primary',
                        )}
                        style={{ width: `${String(optimization.percent)}%` }}
                      />
                    </div>

                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {optimization.complete
                        ? "Fully optimised — the important terms are covered."
                        : `Add ${String(optimization.remaining)} more of the higher-importance terms to reach 100%.`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              aria-label="Article title"
              placeholder="Untitled article"
              className="mb-4 w-full bg-transparent text-center text-3xl font-bold tracking-tight text-foreground placeholder:text-muted-foreground/50 focus:outline-none sm:text-4xl"
            />

            {blocks.length > 0 && (
              <div className="mb-5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {blocks.length} AI suggestion
                    {blocks.length === 1 ? "" : "s"} — review before inserting
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={acceptAll}>
                      Accept all
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setBlocks([]);
                      }}
                    >
                      Reject all
                    </Button>
                  </div>
                </div>

                {blocks.map((block, i) => (
                  <div
                    key={`${String(i)}-${block.slice(0, 24)}`}
                    className="relative overflow-hidden rounded-lg border border-success/30 bg-success/5 p-3"
                  >
                    <div
                      className="prose-editor max-h-48 overflow-y-auto pr-2 text-sm"
                      dangerouslySetInnerHTML={{
                        __html: markdownToHtml(block),
                      }}
                    />
                    <div className="mt-2 flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          accept(i);
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-success px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                      >
                        <Check className="size-3" aria-hidden />
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBlocks((b) => b.filter((_, j) => j !== i));
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                      >
                        <X className="size-3" aria-hidden />
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <RichEditor value={content} onChange={setContent} />
          </div>

          <button
            type="button"
            onClick={() => {
              setAiOpen(true);
            }}
            aria-label="Open AI Writer"
            title={
              aiEnabled
                ? "AI Writer"
                : "AI Writer — needs GROK_API_KEY to be configured"
            }
            className="fixed bottom-5 left-5 z-30 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/20 transition hover:bg-primary/90"
          >
            <Sparkles className="size-5" aria-hidden />
          </button>
        </div>

        {/* ================= Research sidebar ================= */}
        {!wide && (
          <aside className="flex w-full shrink-0 flex-col border-t border-border bg-card xl:w-[22.5rem] xl:border-l xl:border-t-0">
            <div className="flex items-start justify-between gap-2 border-b border-border p-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Keyword
                </p>
                <p className="truncate font-semibold" title={article.keyword}>
                  {article.keyword}
                </p>
              </div>

              <select
                value={status === "preparing" ? "draft" : status}
                onChange={(e) => {
                  const next = e.target.value as ArticleStatus;
                  setStatus(next);
                  void save({ status: next });
                }}
                aria-label="Article status"
                className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ARTICLE_STATUSES.filter((s) => s !== "preparing").map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTab(t.id);
                  }}
                  aria-current={tab === t.id ? "true" : undefined}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-xs transition-colors",
                    tab === t.id
                      ? "bg-primary font-medium text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {researching && (
              <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
                <Loader2
                  className="size-3.5 shrink-0 animate-spin text-primary"
                  aria-hidden
                />
                Researching this keyword — targets appear when it finishes.
              </div>
            )}

            {!researching && briefError !== null && (
              <div className="space-y-2 border-b border-border bg-warning/5 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Keyword research failed: {briefError} You can still write;
                  targets below may be incomplete.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    void runPrepare(true);
                  }}
                >
                  <RefreshCw className="size-3" />
                  Retry research
                </Button>
              </div>
            )}

            {!researching && brief === null && briefError === null && (
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  No research loaded yet.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    void runPrepare(true);
                  }}
                >
                  <RefreshCw className="size-3" />
                  Start research
                </Button>
              </div>
            )}

            <div className="min-h-0 flex-1 xl:overflow-y-auto">
              {tab === "overview" && (
                <>
                  <Section title="Keyword Details">
                    {brief === null ? (
                      <p className="px-3 text-sm text-muted-foreground">
                        {researching
                          ? "Waiting for research…"
                          : "No research available."}
                      </p>
                    ) : (
                      <dl className="text-sm">
                        <div className="flex items-center justify-between px-3 py-2">
                          <dt>
                            Difficulty{" "}
                            <span className="text-xs text-muted-foreground">
                              (0-100)
                            </span>
                          </dt>
                          <dd
                            className={cn(
                              "tabular rounded px-1.5 py-0.5 text-xs font-semibold",
                              difficultyBand(brief.difficulty).chip,
                            )}
                          >
                            {brief.difficulty}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2">
                          <dt>Monthly Searches</dt>
                          <dd className="tabular font-medium">
                            {formatVolume(brief.volume)}/mo
                          </dd>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2">
                          <dt>CPC</dt>
                          <dd className="tabular font-medium">
                            {formatCpc(brief.cpc)}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </Section>

                  <Section title="Content Stats">
                    <StatBar
                      label="Words"
                      value={words}
                      target={targetWords}
                    />
                    <StatBar
                      label="Links"
                      value={links}
                      target={targetLinks}
                    />
                    {brief !== null && brief.terms.length > 0 && (
                      <StatBar
                        label="Keywords used"
                        value={coveredTerms}
                        target={brief.terms.length}
                      />
                    )}
                  </Section>
                </>
              )}

              {tab === "keywords" && (
                <div className="p-2">
                  <p className="px-1 pb-2 text-xs text-muted-foreground">
                    {coveredTerms} of {termStatuses.length} used — ticks update
                    as you write.
                  </p>
                  {termStatuses.length === 0 ? (
                    <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                      {researching
                        ? "Collecting keyword targets…"
                        : "No keyword targets yet."}
                    </p>
                  ) : (
                    <ul>
                      {termStatuses.map((t) => (
                        <li
                          key={t.term}
                          className="flex items-center gap-2 border-b border-border/60 px-1 py-1.5 text-sm last:border-0"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded border",
                              t.done
                                ? "border-success bg-success text-white"
                                : "border-border",
                            )}
                          >
                            {t.done && (
                              <Check className="size-3" strokeWidth={3} />
                            )}
                          </span>
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              t.done && "text-muted-foreground line-through",
                            )}
                          >
                            {t.term}
                          </span>
                          <span
                            title={`Importance ${String(t.weight)} of 100`}
                            className="tabular shrink-0 text-xs text-muted-foreground"
                          >
                            {t.weight}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {tab === "questions" && (
                <div className="p-2">
                  {(brief?.questions ?? []).length === 0 ? (
                    <p className="px-1 py-4 text-sm text-muted-foreground">
                      {researching
                        ? "Looking for common questions…"
                        : "No recurring questions found for this keyword."}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {brief?.questions.map((q) => (
                        <li
                          key={q}
                          className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-sm"
                        >
                          {q}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {tab === "serp" && (
                <div className="p-2">
                  {(brief?.serp ?? []).length === 0 ? (
                    <p className="px-1 py-4 text-sm text-muted-foreground">
                      {researching
                        ? "Reading ranking pages…"
                        : "No results captured."}
                    </p>
                  ) : (
                    <ol className="space-y-1.5">
                      {brief?.serp.map((r) => (
                        <li
                          key={r.url}
                          className="rounded-md border border-border px-2.5 py-2"
                        >
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm font-medium hover:text-primary hover:underline"
                            title={r.title}
                          >
                            <span className="tabular mr-1.5 text-xs text-muted-foreground">
                              {r.position}.
                            </span>
                            {r.title || r.domain}
                          </a>
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.domain} · {r.words.toLocaleString("en-US")} words
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {tab === "meta" && (
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">H1 score</span>
                    <span className="flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "tabular font-medium",
                          titleAnalysis.lengthState === "ok"
                            ? "text-success"
                            : titleAnalysis.lengthState === "empty"
                              ? "text-muted-foreground"
                              : "text-destructive",
                        )}
                      >
                        {titleAnalysis.length}/{TITLE_IDEAL_MAX}
                      </span>
                      <span
                        className={cn(
                          "tabular rounded px-1.5 py-0.5 font-semibold",
                          qualityBand(titleAnalysis.score).chip,
                        )}
                      >
                        {titleAnalysis.score}
                      </span>
                    </span>
                  </div>

                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        titleAnalysis.lengthState === "ok"
                          ? "bg-success"
                          : "bg-primary",
                      )}
                      style={{
                        width: `${String(Math.min(100, (titleAnalysis.length / TITLE_MAX) * 100))}%`,
                      }}
                    />
                  </div>

                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {titleAnalysis.lengthState === "short" &&
                      `Too short — aim for ${String(TITLE_IDEAL_MIN)}–${String(TITLE_IDEAL_MAX)} characters.`}
                    {titleAnalysis.lengthState === "long" &&
                      `Too long — Google truncates past about ${String(TITLE_IDEAL_MAX)} characters.`}
                    {titleAnalysis.lengthState === "ok" &&
                      `Good length. The sweet spot is ${String(TITLE_IDEAL_MIN)}–${String(TITLE_IDEAL_MAX)}.`}
                    {titleAnalysis.lengthState === "empty" &&
                      `Aim for ${String(TITLE_IDEAL_MIN)}–${String(TITLE_IDEAL_MAX)} characters.`}
                  </p>

                  <ul className="mt-2.5 space-y-1">
                    {titleAnalysis.reasons.map((r) => (
                      <li
                        key={r.label}
                        className="flex items-baseline justify-between gap-2 text-xs"
                      >
                        <span
                          className={
                            r.points === 0 ? "text-muted-foreground" : ""
                          }
                        >
                          {r.label}
                        </span>
                        <span className="tabular shrink-0 font-medium">
                          +{r.points}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {titleAnalysis.missingWords.length > 0 && (
                    <div className="mt-2.5">
                      <p className="text-xs font-medium">
                        Missing important words
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {titleAnalysis.missingWords.map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => {
                              setTitle((t) => `${t.trimEnd()} ${w}`.trim());
                            }}
                            title={`Append "${w}" to the title`}
                            className="rounded-md border border-border px-1.5 py-0.5 text-xs transition-colors hover:border-primary hover:text-primary"
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {titleAnalysis.suggestions.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {titleAnalysis.suggestions.map((s) => (
                        <li
                          key={s}
                          className="text-xs leading-relaxed text-muted-foreground"
                        >
                          • {s}
                        </li>
                      ))}
                    </ul>
                  )}

                  <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Words</dt>
                      <dd className="tabular">
                        {words.toLocaleString("en-US")}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Links</dt>
                      <dd className="tabular">{links}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Pages analysed</dt>
                      <dd className="tabular">{brief?.analysed ?? 0}</dd>
                    </div>
                  </dl>

                  {brief !== null && (
                    <p className="pt-2 text-xs text-muted-foreground">
                      Researched{" "}
                      {new Date(brief.builtAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      . Targets are a snapshot from when research finished.
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>AI Writer</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <p className="font-medium">What would you like the AI to do?</p>
              <p className="text-sm text-muted-foreground">
                Suggestions appear as reviewable blocks — accept only what you
                want.
              </p>
            </div>

            {!aiEnabled && (
              <p
                role="alert"
                className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-muted-foreground"
              >
                No AI key is configured yet. Set{" "}
                <code className="rounded bg-muted px-1">GROK_API_KEY</code> in
                the environment and this will start working.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="ai-instruction">Instructions</Label>
              <Textarea
                id="ai-instruction"
                value={instruction}
                onChange={(e) => {
                  setInstruction(e.target.value);
                }}
                placeholder="e.g. Write a conclusion summarizing the key points"
                rows={5}
                maxLength={2000}
              />
            </div>

            {brief !== null && (brief.questions.length > 0 || brief.headings.length > 0) && (
              <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="text-xs font-medium">
                  Suggestions from the research
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Questions readers ask about “{article.keyword}”, and the
                  sections the ranking pages cover. Pick one to write it.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    ...brief.questions
                      .slice(0, 6)
                      .map((q) => ({
                        chip: q,
                        prompt: `Write a section that answers this question in full: "${q}"`,
                      })),
                    ...brief.headings.slice(0, 4).map((h) => ({
                      chip: h.text,
                      prompt: `Write the "${h.text}" section of this article.`,
                    })),
                  ].map((s) => (
                    <button
                      key={s.chip}
                      type="button"
                      onClick={() => {
                        setInstruction(s.prompt);
                      }}
                      title={s.prompt}
                      className="max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      {s.chip}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {brief !== null && (
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Write the full article, with sections and images",
                  "Write an introduction for this article",
                  "Draft the full outline as headings",
                  "Write a conclusion summarizing the key points",
                  "Add an FAQ section answering the common questions",
                ].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setInstruction(p);
                    }}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAiOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void runAi()}
              disabled={generating || instruction.trim() === ""}
            >
              {generating ? (
                <>
                  <Loader2 className="animate-spin" />
                  Generating…
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
