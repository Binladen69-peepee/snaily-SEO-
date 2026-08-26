"use client";

import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  FileUp,
  History,
  ImagePlus,
  Loader2,
  PanelRight,
  PenLine,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { RichEditor } from "@/components/articles/rich-editor";
import { WordPressExportDialog } from "@/components/articles/wp-export-dialog";
import { useSetup } from "@/components/setup/setup-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import {
  ARTICLE_STATUSES,
  markdownLinks,
  markdownWords,
  STATUS_LABEL,
  type ArticleBrief,
  type ArticleMode,
  type ArticlePhase,
  type ArticleStatus,
  type DraftComment,
} from "@/lib/articles";
import { researchPanelSummary } from "@/lib/drafter/research";
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
import {
  readingMinutes,
  slugFromTitle,
  type ArticleRevision,
  type EditorialMeta,
} from "@/lib/drafter/editorial";
import {
  DraftProgress,
  useDraftJob,
} from "@/components/articles/draft-progress";
import { OutlinePanel } from "@/components/articles/outline-panel";
import { QualityPanel } from "@/components/articles/quality-panel";
import { RecipePanel } from "@/components/articles/recipe-panel";
import { TermSelect, type SiteTermOption } from "@/components/articles/term-select";
import {
  hasRecipe,
  validateRecipe,
  type RecipeCard,
} from "@/lib/drafter/recipe";
import { editorialSeo } from "@/lib/drafter/seo-panel";
import { gutenbergToPreviewHtml } from "@/lib/wordpress/gutenberg";
import { sanitizeEditorHtml } from "@/lib/drafter/sanitize";
import type { WordpressHealth } from "@/lib/setup/state";
import { cn } from "@/lib/utils";

type SidebarTab =
  | "seo"
  | "keywords"
  | "meta"
  | "comments"
  | "outline"
  | "quality"
  | "recipe";

const TABS: { id: SidebarTab; label: string }[] = [
  { id: "meta", label: "Post" },
  { id: "seo", label: "SEO" },
  { id: "outline", label: "Outline" },
  { id: "quality", label: "Quality" },
  { id: "recipe", label: "Recipe" },
  { id: "keywords", label: "Keywords" },
  { id: "comments", label: "Comments" },
];

export function ArticleEditor({
  article,
  comments: initialComments,
  brief: initialBrief,
  briefError: initialBriefError,
  editorial: initialEditorial,
  recipeCard: initialRecipe,
  revisions: initialRevisions,
  aiEnabled,
  wpHealth: initialWpHealth,
  hasDrive,
  driveFolderId,
  siteCategories,
  siteTags,
}: {
  article: {
    id: string;
    title: string;
    keyword: string;
    status: ArticleStatus;
    content: string;
    mode: ArticleMode;
    phase: ArticlePhase | "";
    driveFileUrl: string;
    wpEditLink: string;
    wpDraftId: number | null;
    wpSyncedAt: string | null;
    projectId: string;
    /** The project's own site, so internal links are recognised as internal. */
    siteUrl: string;
  };
  comments: DraftComment[];
  brief: ArticleBrief | null;
  briefError: string | null;
  editorial: EditorialMeta;
  recipeCard: RecipeCard;
  revisions: ArticleRevision[];
  aiEnabled: boolean;
  wpHealth: WordpressHealth;
  hasDrive: boolean;
  driveFolderId: string;
  siteCategories: SiteTermOption[];
  siteTags: SiteTermOption[];
}) {
  const isDrafter = article.mode === "drafter";
  const router = useRouter();
  const { snapshot, openWpGate, refreshSnapshot } = useSetup();
  const wpHealth: WordpressHealth =
    snapshot?.wordpress.health ?? initialWpHealth;
  const [title, setTitle] = useState(article.title);
  const [content, setContent] = useState(article.content);
  const [status, setStatus] = useState<ArticleStatus>(
    article.status === "preparing" ? "draft" : article.status,
  );
  const [phase, setPhase] = useState<ArticlePhase | "">(article.phase);
  const [notes, setNotes] = useState<DraftComment[]>(initialComments);
  const [brief, setBrief] = useState<ArticleBrief | null>(initialBrief);
  const [briefError, setBriefError] = useState<string | null>(initialBriefError);
  const [researching, setResearching] = useState(
    initialBrief === null && initialBriefError === null,
  );
  const [tab, setTab] = useState<SidebarTab>("meta");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("saved");
  const [wide, setWide] = useState(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [generating, setGenerating] = useState(false);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [drafterBusy, setDrafterBusy] = useState<"drive" | "wordpress" | null>(
    null,
  );
  const [driveUrl, setDriveUrl] = useState(article.driveFileUrl);
  const [wpUrl, setWpUrl] = useState(article.wpEditLink);
  const [wpDraftId, setWpDraftId] = useState(article.wpDraftId);
  const [view, setView] = useState<"editor" | "preview">("editor");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [meta, setMetaRaw] = useState<EditorialMeta>(initialEditorial);
  const [recipe, setRecipeRaw] = useState<RecipeCard>(initialRecipe);

  /*
   * Whether the author has actually edited these two structured panels.
   *
   * The background drafter fills the recipe card and the SEO fields while this
   * editor is open, and the autosave below posts its entire in-memory state on
   * a 900ms debounce. So a page opened before generation finished was holding
   * an empty recipe card, and the next keystroke anywhere in the document
   * PATCHed that empty card over the fifteen ingredients the job had just
   * written - which is why the Recipe tab came back showing nothing but its own
   * placeholder text. A panel the author has not touched is simply not sent,
   * and gets refreshed from the server when the job reports finished.
   */
  const recipeTouched = useRef(false);
  const metaTouched = useRef(false);

  const setRecipe = useCallback((next: RecipeCard) => {
    recipeTouched.current = true;
    setRecipeRaw(next);
  }, []);

  const setMeta = useCallback(
    (update: (current: EditorialMeta) => EditorialMeta) => {
      metaTouched.current = true;
      setMetaRaw(update);
    },
    [],
  );
  const [revisions, setRevisions] = useState<ArticleRevision[]>(initialRevisions);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const words = markdownWords(content);
  const links = markdownLinks(content);
  const targetWords = brief?.targetWords ?? 0;
  const targetLinks = brief?.targetLinks ?? 0;

  const termStatuses = useMemo(
    () =>
      checkTerms(
        `${title}\n${content}`,
        (brief?.terms ?? []).filter((t) => !meta.dismissedTerms.includes(t.term)),
      ),
    [title, content, brief, meta.dismissedTerms],
  );
  const coveredTerms = termStatuses.filter((t) => t.done).length;

  /** Headline optimisation score — 75% weighted coverage reads as 100%. */
  const optimization = useMemo(
    () => optimizationScore(termStatuses),
    [termStatuses],
  );

  const seoChecks = useMemo(
    () =>
      editorialSeo({
        title,
        keyword: article.keyword,
        html: content,
        seoTitle: meta.seoTitle,
        seoDescription: meta.seoDescription,
        excerpt: meta.excerpt,
        featured: meta.featuredAssetId !== "" || meta.featuredImageUrl !== "",
        coveredTerms,
        totalTerms: termStatuses.length,
        optimization: optimization.percent,
        siteUrl: article.siteUrl,
        // Null keeps the check off the panel entirely for a post with no
        // recipe on it, rather than showing a permanent red mark.
        recipeValid: hasRecipe(recipe)
          ? validateRecipe(recipe).every((i) => i.severity !== "error")
          : null,
      }),
    [
      title,
      article.keyword,
      article.siteUrl,
      content,
      meta,
      recipe,
      coveredTerms,
      termStatuses.length,
      optimization.percent,
    ],
  );

  const minutes = readingMinutes(words);

  const titleAnalysis = useMemo(
    () =>
      analyseTitle(
        title,
        article.keyword,
        (brief?.titleWords?.length
          ? brief.titleWords
          : (brief?.research?.titleTerms ?? []).map((t) => t.term)
        ).slice(0, 12),
        brief?.terms ?? [],
      ),
    [title, article.keyword, brief],
  );

  const searchResearch = useMemo(
    () => researchPanelSummary(brief?.research ?? null),
    [brief],
  );

  const save = useCallback(
    async (patch: {
      title?: string;
      content?: string;
      status?: ArticleStatus;
      comments?: DraftComment[];
      editorial?: EditorialMeta;
      recipeCard?: RecipeCard;
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

  /**
   * Loads the article the background job just finished writing.
   *
   * A fetch rather than a router refresh: the author may already be typing in
   * this editor while the last stages run, and reloading the route would throw
   * away their caret, their scroll position and any unsaved keystroke. The
   * title is only adopted when they have not renamed it themselves, matching
   * what the save stage does on the server.
   */
  const loadFinishedDraft = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${article.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        title: string;
        content: string;
        phase: ArticlePhase | "";
        editorial: EditorialMeta;
        recipeCard: RecipeCard;
      };

      setContent(data.content);
      setPhase(data.phase);
      // Raw setters: loading a finished draft is not the author editing it.
      setMetaRaw((m) => ({
        ...m,
        seoTitle: m.seoTitle || data.editorial.seoTitle,
        seoDescription: m.seoDescription || data.editorial.seoDescription,
        slug: m.slug || data.editorial.slug,
        excerpt: m.excerpt || data.editorial.excerpt,
      }));
      if (!recipeTouched.current) setRecipeRaw(data.recipeCard);
      setTitle((current) => (current === article.title ? data.title : current));
      setStatus("draft");
      toast.success("Your article is ready.");
    } catch {
      toast.error("The draft finished but could not be loaded — reload the page.");
    }
  }, [article.id, article.title]);

  const draftJob = useDraftJob(article.id, () => {
    void loadFinishedDraft();
  });

  /*
   * Drafter: one click, once, when the editor opens on an empty article.
   *
   * The old version called the generation endpoint directly and held the
   * request open for the whole draft. This only creates the job; every stage
   * after that runs in its own invocation, which is why closing the tab here
   * no longer costs the author their article.
   */
  const draftStarted = useRef(false);
  useEffect(() => {
    if (!isDrafter || draftStarted.current) return;
    if (article.content.trim() !== "") return;
    draftStarted.current = true;
    void draftJob.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional once-on-mount
  }, []);

  useEffect(() => {
    const id = "cs-droid-serif";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Droid+Serif:ital,wght@0,400;0,700;1,400&display=swap";
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const drive = params.get("drive");
    if (drive === "connected") toast.success("Google Drive connected");
    if (drive === "error") toast.error("Could not connect Google Drive");
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
      void save({
        title,
        content,
        ...(metaTouched.current ? { editorial: meta } : {}),
        ...(recipeTouched.current ? { recipeCard: recipe } : {}),
      });
    }, 900);
    return () => {
      clearTimeout(timer);
    };
  }, [title, content, meta, recipe, save]);

  /**
   * Scroll the editor to the nth heading.
   *
   * Matched by document order rather than by text: two sections can share a
   * title, and the outline already distinguishes them by position.
   */
  const jumpToHeading = useCallback((index: number) => {
    const root = document.querySelector(".prose-editor");
    const headings = root?.querySelectorAll("h2, h3, h4");
    const target = headings?.[index];
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    // A brief flash confirms which heading was hit when several are in view.
    target.classList.add("outline-jump");
    window.setTimeout(() => {
      target.classList.remove("outline-jump");
    }, 1200);
  }, []);

  /**
   * Google Drive export.
   *
   * WordPress goes through `WordPressExportDialog` instead: it needs a preview
   * of the template mapping before anything is sent, which is a conversation
   * rather than a button press.
   */
  async function exportToDrive() {
    if (!hasDrive) {
      window.location.href = `/api/google/drive?next=/content-assistant/${article.id}`;
      return;
    }
    setDrafterBusy("drive");
    try {
      const res = await fetch(`/api/articles/${article.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dest: "drive" }),
      });
      const data = (await res.json()) as {
        url?: string;
        error?: string;
        needsAuth?: boolean;
      };

      if (res.status === 401 && data.needsAuth) {
        window.location.href = `/api/google/drive?next=/content-assistant/${article.id}`;
        return;
      }

      if (!res.ok) {
        toast.error(data.error ?? "Export failed");
        return;
      }

      setDriveUrl(data.url ?? "");
      toast.success("Saved to Google Drive");
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setDrafterBusy(null);
    }
  }

  function addComment(quote: string, note: string, id: string) {
    const next = [...notes, { id, quote, note }];
    setNotes(next);
    void save({ comments: next });
  }

  function removeComment(id: string) {
    const next = notes.filter((c) => c.id !== id);
    setNotes(next);
    void save({ comments: next });
  }

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

  async function deleteArticle() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Could not delete the article");
        return;
      }
      toast.success("Article deleted");
      setDeleteOpen(false);
      router.push("/content-assistant");
      router.refresh();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-svh max-h-svh flex-col overflow-hidden bg-background">
      {/* Gutenberg-style document toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-background px-2 py-1.5 sm:px-3">
        <Link
          href="/content-assistant"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline">Drafter</span>
        </Link>

        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />

        <p className="hidden min-w-0 truncate text-sm font-medium md:block md:max-w-[16rem]">
          {title.trim() || "Add title"}
        </p>

        {isDrafter && phase !== "" && (
          <span className="hidden rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground lg:inline">
            {phase === "outline"
              ? "Outline"
              : phase === "draft"
                ? "Draft"
                : "Proofed"}
          </span>
        )}

        <div className="flex-1" />

        <div className="flex items-center rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => {
              setView("editor");
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium",
              view === "editor"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <PenLine className="size-3.5" />
            Editor
          </button>
          <button
            type="button"
            onClick={() => {
              setView("preview");
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium",
              view === "preview"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Eye className="size-3.5" />
            Preview
          </button>
        </div>

        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs",
            saving === "saved"
              ? "text-success"
              : saving === "saving"
                ? "text-muted-foreground"
                : "text-warning",
          )}
        >
          {saving === "saving" ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
          )}
          {saving === "saving"
            ? "Saving…"
            : saving === "saved"
              ? "Saved"
              : "Unsaved"}
        </span>

        {isDrafter && (
          <>
            <button
              type="button"
              disabled={drafterBusy !== null || content.trim() === ""}
              title={
                driveFolderId
                  ? "Saves to the connected Google Drive folder"
                  : "Connect Drive, then pick a folder in project settings"
              }
              onClick={() => {
                void exportToDrive();
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {drafterBusy === "drive" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <FileUp className="size-3.5" aria-hidden />
              )}
              <span className="hidden xl:inline">
                {driveUrl ? "Update Drive" : "Save to Drive"}
              </span>
            </button>
            <button
              type="button"
              disabled={drafterBusy !== null || content.trim() === ""}
              title="Send this draft to WordPress"
              onClick={() => {
                if (wpHealth !== "connected") {
                  openWpGate(
                    wpHealth === "connection_lost"
                      ? "connection_lost"
                      : "not_configured",
                  );
                  return;
                }
                setPreflightOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {drafterBusy === "wordpress" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <FileUp className="size-3.5" aria-hidden />
              )}
              {wpUrl ? "Update WP" : "Send to WP"}
            </button>
            <button
              type="button"
              onClick={() => {
                setHistoryOpen(true);
              }}
              aria-label="Version history"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <History className="size-3.5" />
            </button>
          </>
        )}

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
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Sparkles className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={exportArticle}
          aria-label="Export HTML"
          className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
        >
          <Download className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={() => {
            setDeleteOpen(true);
          }}
          aria-label="Delete article"
          title="Delete article"
          className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90"
        >
          <Trash2 className="size-3.5" />
          <span className="hidden sm:inline">Delete</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSidebarOpen(true);
            setWide(false);
          }}
          aria-label="Open post settings"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground xl:hidden"
        >
          <PanelRight className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={() => {
            setWide((w) => !w);
          }}
          aria-label={wide ? "Show settings sidebar" : "Hide settings sidebar"}
          className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground xl:inline-flex"
        >
          {wide ? (
            <Settings className="size-3.5" />
          ) : (
            <Settings className="size-3.5 text-foreground" />
          )}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* ================= Canvas ================= */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          {view === "preview" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[42rem] px-5 pt-6 pb-16 sm:px-8">
                <h1
                  className="mb-3 text-center text-3xl font-extrabold leading-[1.15] tracking-tight text-foreground sm:text-4xl"
                  style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
                >
                  {title.trim() || "Add title"}
                </h1>
                <article className="cs-preview">
                  <div
                    className="cs-post"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeEditorHtml(
                        gutenbergToPreviewHtml(toEditorHtml(content)),
                      ),
                    }}
                  />
                </article>
              </div>
            </div>
          ) : (
            <RichEditor
              value={content}
              onChange={setContent}
              commentsEnabled={isDrafter}
              onAddComment={addComment}
              articleId={article.id}
              variant="canvas"
              className="min-h-0 flex-1"
              lead={
                <>
                  {isDrafter && draftJob.job !== null && (
                    <div className="mb-6">
                      <DraftProgress
                        job={draftJob.job}
                        onJobChange={draftJob.setJob}
                        onDismiss={draftJob.dismiss}
                      />
                    </div>
                  )}
                  {isDrafter && draftJob.job === null && draftJob.starting && (
                    <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                      Starting…
                    </div>
                  )}
                  <input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (meta.slug === "") {
                        setMeta((m) => ({ ...m, slug: slugFromTitle(e.target.value) }));
                      }
                    }}
                    aria-label="Post title"
                    placeholder="Add title"
                    className={cn(
                      "mb-2 w-full bg-transparent text-left text-3xl font-extrabold leading-[1.15] tracking-tight placeholder:text-muted-foreground/40 focus:outline-none sm:text-4xl",
                      titleAnalysis.lengthState === "long"
                        ? "text-destructive"
                        : "text-foreground",
                    )}
                    style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
                  />
                  {blocks.length > 0 && (
                    <div className="mb-4 space-y-2">
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
                </>
              }
            />
          )}

          <div className="z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-background/95 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
            <span className="tabular">{words.toLocaleString("en-US")} words</span>
            <span>{minutes} min read</span>
            <span>SEO {optimization.percent}%</span>
            <span>
              {saving === "saving"
                ? "Saving…"
                : saving === "saved"
                  ? "Saved"
                  : "Unsaved changes"}
            </span>
            {driveUrl !== "" && (
              <a href={driveUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
                Drive saved
              </a>
            )}
            {wpUrl !== "" && (
              <a href={wpUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
                {article.wpSyncedAt
                  ? `WP draft · ${new Date(article.wpSyncedAt).toLocaleString()}`
                  : "WP draft"}
              </a>
            )}
          </div>
        </div>

        {/* ================= Research sidebar ================= */}
        {!wide && sidebarOpen && (
          <button
            type="button"
            aria-label="Close research panel"
            className="fixed inset-0 z-40 bg-black/40 xl:hidden"
            onClick={() => {
              setSidebarOpen(false);
            }}
          />
        )}
        {!wide && (
          <aside
            className={cn(
              "flex w-full shrink-0 flex-col border-border bg-card",
              "xl:flex xl:w-[22.5rem] xl:border-l xl:border-t-0",
              sidebarOpen
                ? "fixed inset-y-0 right-0 z-50 w-[min(100%,22.5rem)] border-l shadow-xl"
                : "hidden border-t xl:relative xl:flex",
            )}
          >
            <div className="space-y-2.5 border-b border-border p-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Target keyword
                </p>
                <p
                  className="mt-0.5 truncate text-[15px] font-semibold leading-tight"
                  title={article.keyword}
                >
                  {article.keyword}
                </p>
              </div>

              {/*
                Status sits on its own line. Sharing a row with the keyword
                squeezed both: the keyword truncated early and the select never
                had room for its longest label.
              */}
              <SearchableSelect
                size="sm"
                className="w-full"
                aria-label="Article status"
                value={status === "preparing" ? "draft" : status}
                options={ARTICLE_STATUSES.filter((s) => s !== "preparing").map((s) => ({
                  value: s,
                  label: STATUS_LABEL[s],
                }))}
                onChange={(next) => {
                  const value = next as ArticleStatus;
                  setStatus(value);
                  void save({ status: value });
                }}
              />
            </div>

            {/*
              Seven tabs do not fit across 22.5rem, and an overflow scroller put
              a scrollbar through the middle of the panel while hiding half the
              tabs behind a swipe. They wrap instead: two tidy rows, everything
              reachable, no scrollbar.
            */}
            <div
              role="tablist"
              aria-label="Research panel"
              className="flex flex-wrap gap-1 border-b border-border bg-muted/30 p-2"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  onClick={() => {
                    setTab(t.id);
                  }}
                  aria-selected={tab === t.id}
                  aria-current={tab === t.id ? "true" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tab === t.id
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
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

            {!researching && brief !== null && (
              <div className="border-b border-border px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Search research
                  </p>
                  {/*
                    A bare "DataForSEO ✓" read as decoration. A tinted pill says
                    the same thing as state: which provider answered, and
                    whether this came off the wire or out of the cache.
                  */}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      searchResearch.available
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {searchResearch.providerLabel}
                    {searchResearch.cacheHit ? " · cached" : ""}
                  </span>
                </div>
                {searchResearch.available ? (
                  <dl className="mt-2.5 grid grid-cols-2 gap-1.5">
                    {[
                      ["Top results", searchResearch.topResults],
                      ["PAA questions", searchResearch.paa],
                      ["SERP features", searchResearch.serpFeatures],
                      ["Related", searchResearch.relatedSearches],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-md border border-border bg-muted/40 px-2 py-1.5"
                      >
                        <dd className="tabular text-sm font-semibold leading-none">
                          {value}
                        </dd>
                        <dt className="mt-1 text-[10px] leading-none text-muted-foreground">
                          {label}
                        </dt>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Search research unavailable — drafting continues without
                    fabricated SERP data.
                  </p>
                )}
              </div>
            )}

            <div className="min-h-0 flex-1 xl:overflow-y-auto">
              {tab === "seo" && (
                <div className="p-3">
                  {termStatuses.length > 0 && (
                    <div className="mb-3 rounded-md border border-border px-2.5 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">Content score</span>
                        <span
                          className={cn(
                            "tabular text-lg font-bold",
                            qualityBand(optimization.percent).className,
                          )}
                        >
                          {optimization.percent}%
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {optimization.used} of {optimization.total} terms ·{" "}
                        {Math.round(optimization.weightedCoverage * 100)}% weighted
                      </p>
                    </div>
                  )}

                  <div className="mb-3">
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
                            : titleAnalysis.lengthState === "long"
                              ? "bg-destructive"
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
                          <span className={r.points === 0 ? "text-muted-foreground" : ""}>
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
                        <p className="text-xs font-medium">Missing important words</p>
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
                  </div>

                  <div className="mb-3 space-y-3 border-t border-border pt-3">
                    <label className="block text-xs font-medium">
                      SEO title
                      <input
                        value={meta.seoTitle}
                        onChange={(e) => {
                          setMeta((m) => ({ ...m, seoTitle: e.target.value }));
                        }}
                        maxLength={200}
                        className={cn(
                          "mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm",
                          meta.seoTitle.length > 60
                            ? "border-destructive text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                            : "border-input",
                        )}
                      />
                      <span
                        className={cn(
                          "mt-0.5 block text-[11px]",
                          meta.seoTitle.length > 60
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {meta.seoTitle.length}/60
                      </span>
                    </label>
                    <label className="block text-xs font-medium">
                      Meta description
                      <textarea
                        value={meta.seoDescription}
                        onChange={(e) => {
                          setMeta((m) => ({ ...m, seoDescription: e.target.value }));
                        }}
                        rows={3}
                        maxLength={400}
                        className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                      />
                      <span
                        className={cn(
                          "mt-0.5 block text-[11px]",
                          meta.seoDescription.length > 160
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {meta.seoDescription.length}/160
                      </span>
                    </label>
                  </div>

                  <p className="mb-2 text-xs text-muted-foreground">
                    Counts from this draft. Nothing here is invented.
                  </p>
                  <ul className="space-y-2">
                    {seoChecks.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-md border border-border px-2.5 py-2"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">{c.label}</span>
                          <span className="tabular text-xs font-semibold">
                            {c.score === null ? c.value : `${c.value} · ${String(c.score)}`}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
                      </li>
                    ))}
                  </ul>
                  {(brief?.questions ?? []).length > 0 && (
                    <div className="mt-4">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Questions
                      </p>
                      <ul className="space-y-1.5">
                        {brief?.questions.map((q) => (
                          <li
                            key={q}
                            className="rounded-md border border-border px-2.5 py-2 text-sm"
                          >
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(brief?.serp ?? []).length > 0 && (
                    <div className="mt-4">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        SERP
                      </p>
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
                    </div>
                  )}
                </div>
              )}

              {tab === "outline" && (
                <div className="p-3">
                  <OutlinePanel html={content} onJump={jumpToHeading} />
                </div>
              )}

              {tab === "quality" && (
                <div className="p-3">
                  <QualityPanel html={content} articleId={article.id} />
                </div>
              )}

              {tab === "recipe" && (
                <div className="p-3">
                  <RecipePanel
                    recipe={recipe}
                    onChange={setRecipe}
                    fallbackName={title}
                    fallbackImage={meta.featuredImageUrl}
                  />
                </div>
              )}

              {tab === "keywords" && (
                <div className="p-2">
                  {brief !== null && (
                    <dl className="mb-2 grid grid-cols-3 gap-1 border-b border-border px-1 pb-2 text-center">
                      <div>
                        <dt className="text-[11px] text-muted-foreground">Difficulty</dt>
                        <dd
                          className={cn(
                            "tabular text-sm font-semibold",
                            difficultyBand(brief.difficulty).className,
                          )}
                        >
                          {brief.difficulty}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-muted-foreground">Volume</dt>
                        <dd className="tabular text-sm font-semibold">
                          {formatVolume(brief.volume)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-muted-foreground">CPC</dt>
                        <dd className="tabular text-sm font-semibold">
                          {formatCpc(brief.cpc)}
                        </dd>
                      </div>
                    </dl>
                  )}
                  {(targetWords > 0 || targetLinks > 0) && (
                    <p className="px-1 pb-2 text-xs text-muted-foreground">
                      Target {targetWords.toLocaleString("en-US")} words ·{" "}
                      {targetLinks} links — {words.toLocaleString("en-US")} / {links}{" "}
                      now
                    </p>
                  )}
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
                          <button
                            type="button"
                            title="Ignore for this article"
                            onClick={() => {
                              setMeta((m) => ({
                                ...m,
                                dismissedTerms: [...m.dismissedTerms, t.term],
                              }));
                            }}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            Ignore
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {tab === "meta" && (
                <div className="p-3">
                  {/* Three numbers that describe the draft, as tiles rather
                      than bare figures on a divider. */}
                  <div className="mb-4 grid grid-cols-3 gap-2">
                    {[
                      { value: words.toLocaleString("en-US"), label: "Words", tone: "" },
                      { value: String(minutes), label: "Min read", tone: "" },
                      {
                        value: String(optimization.percent),
                        label: "SEO score",
                        tone: qualityBand(optimization.percent).className,
                      },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="rounded-lg border border-border bg-muted/40 px-2 py-2 text-center"
                      >
                        <p className={cn("tabular text-lg font-semibold leading-none", s.tone)}>
                          {s.value}
                        </p>
                        <p className="mt-1 text-[10px] leading-none text-muted-foreground">
                          {s.label}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Status is not repeated here: it sits at the top of the
                      panel, where it is visible from every tab. */}
                  <div className="space-y-3.5">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium">Slug</span>
                      <input
                        value={meta.slug}
                        onChange={(e) => {
                          setMeta((m) => ({ ...m, slug: e.target.value }));
                        }}
                        className="h-9 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="flex items-baseline justify-between text-xs font-medium">
                        Excerpt
                        <span
                          className={cn(
                            "tabular text-[10px] font-normal",
                            meta.excerpt.length > 160
                              ? "text-warning"
                              : "text-muted-foreground",
                          )}
                        >
                          {meta.excerpt.length}/160
                        </span>
                      </span>
                      <textarea
                        value={meta.excerpt}
                        onChange={(e) => {
                          setMeta((m) => ({ ...m, excerpt: e.target.value }));
                        }}
                        rows={3}
                        className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                    <TermSelect
                      id="post-categories"
                      label="Categories"
                      value={meta.categories}
                      terms={siteCategories}
                      emptyHint="Sync WordPress to pick live categories"
                      onChange={(categories) => {
                        setMeta((m) => ({ ...m, categories }));
                      }}
                    />
                    <TermSelect
                      id="post-tags"
                      label="Tags"
                      value={meta.tags}
                      terms={siteTags}
                      emptyHint="Sync WordPress to pick live tags"
                      onChange={(tags) => {
                        setMeta((m) => ({ ...m, tags }));
                      }}
                    />
                    {/*
                      The browser's own file control rendered as
                      "Choose File | No file chosen" — unstyled, and it says
                      nothing about what the file is for. The input is still
                      there and still does the work; it is just visually
                      replaced by its own label.
                    */}
                    <div className="space-y-1">
                      <span className="text-xs font-medium">Featured image</span>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-2.5",
                          "text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <ImagePlus className="size-4 shrink-0" aria-hidden />
                        {meta.featuredImageUrl === ""
                          ? "Upload a JPG, PNG or WebP"
                          : "Replace image"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          void (async () => {
                            const { uploadArticleImage } = await import(
                              "@/components/articles/upload-image"
                            );
                            try {
                              const asset = await uploadArticleImage(article.id, file);
                              setMeta((m) => ({
                                ...m,
                                featuredAssetId: asset.id,
                                featuredImageUrl: asset.url,
                              }));
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "Upload failed",
                              );
                            }
                          })();
                        }}
                      />
                      </label>
                      {meta.featuredImageUrl !== "" && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={meta.featuredImageUrl}
                          alt=""
                          className="max-h-32 w-full rounded-md border border-border object-cover"
                        />
                      )}
                    </div>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium">
                        Protected vocabulary
                      </span>
                      <input
                        value={meta.protectedVocab.join(", ")}
                        onChange={(e) => {
                          setMeta((m) => ({
                            ...m,
                            protectedVocab: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          }));
                        }}
                        placeholder="mücver, yalanji, za’atar"
                        className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <span className="block text-[10px] text-muted-foreground">
                        Words the proofreader must never “correct”.
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {tab === "comments" && (
                <div className="p-3">
                  {notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Select text in the editor and click Add comment.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {notes.map((c) => (
                        <li
                          key={c.id}
                          className="rounded-md border border-border px-2.5 py-2 text-sm"
                        >
                          <p className="text-xs text-muted-foreground">
                            “{c.quote.slice(0, 160)}
                            {c.quote.length > 160 ? "…" : ""}”
                          </p>
                          <p className="mt-1">{c.note}</p>
                          <button
                            type="button"
                            onClick={() => {
                              removeComment(c.id);
                            }}
                            className="mt-1 text-xs text-muted-foreground hover:text-destructive"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <WordPressExportDialog
        articleId={article.id}
        open={preflightOpen}
        onOpenChange={setPreflightOpen}
        update={wpDraftId !== null && wpDraftId > 0}
        onGate={(reason) => {
          void refreshSnapshot();
          openWpGate(
            reason === "route_missing"
              ? "outdated"
              : reason === "connection_lost"
                ? "connection_lost"
                : "not_configured",
            reason === "route_missing"
              ? () => {
                  setPreflightOpen(true);
                }
              : undefined,
          );
        }}
        onExported={(result) => {
          setWpUrl(result.url);
          setWpDraftId(result.id);
          void refreshSnapshot();
        }}
      />

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
          </DialogHeader>
          {revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Outline, redraft and proofread each leave a snapshot here.
            </p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {[...revisions].reverse().map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium capitalize">{r.kind}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void (async () => {
                        const res = await fetch(
                          `/api/articles/${article.id}/revisions`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ revisionId: r.id }),
                          },
                        );
                        const data = (await res.json()) as {
                          title?: string;
                          content?: string;
                          revisions?: ArticleRevision[];
                          error?: string;
                        };
                        if (!res.ok) {
                          toast.error(data.error ?? "Could not restore.");
                          return;
                        }
                        if (data.title) setTitle(data.title);
                        if (data.content) setContent(data.content);
                        if (data.revisions) setRevisions(data.revisions);
                        setHistoryOpen(false);
                        toast.success("Restored that version.");
                      })();
                    }}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this article?</DialogTitle>
            <DialogDescription>
              “{title.trim() || "Untitled"}” will be removed from Drafter. This
              cannot be undone. WordPress drafts are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                void deleteArticle();
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
