"use client";

/**
 * The left panel: what the article is made from, and how to remake it.
 *
 * The research panel on the right answers "what should this article be" —
 * keyword, SERP, SEO, quality. This one answers the other half: here is the
 * recipe it was built from, here is the shape it came out, and here are the
 * buttons that build it again. Those controls existed already but were spread
 * across a toolbar, two dialogs and a tab, so the one screen that is entirely
 * about the article had no single place to act on it.
 *
 * Every section collapses, and which ones are open is remembered per browser —
 * a writer working on the recipe does not want the history in the way, and
 * should not have to close it twice.
 */

import {
  AlertTriangle,
  Check,
  ChevronRight,
  History,
  ListTree,
  Loader2,
  RotateCw,
  Sparkles,
  UtensilsCrossed,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cardCompleteness } from "@/lib/drafter/card-completeness";
import type { ArticleRevision } from "@/lib/drafter/editorial";
import { outlineMap } from "@/lib/drafter/outline-map";
import type { RecipeCard } from "@/lib/drafter/recipe";
import { cn } from "@/lib/utils";

type SectionId = "generate" | "sections" | "recipe" | "history";

const OPEN_KEY = "snaily.controlPanel.open";
const DEFAULT_OPEN: SectionId[] = ["generate", "sections", "recipe"];

function Collapsible({
  id,
  title,
  icon,
  badge,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => {
          onToggle(id);
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {badge}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** A small count chip, tinted when something needs attention. */
function CountBadge({
  text,
  tone = "muted",
}: {
  text: string;
  tone?: "muted" | "warn" | "ok";
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular",
        tone === "warn" &&
          "border-warning/40 bg-warning/10 text-warning-foreground dark:text-amber-300",
        tone === "ok" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "muted" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}

export function ArticleControlPanel({
  recipe,
  content,
  revisions,
  isDrafter,
  jobRunning,
  onStartDraft,
  onRedraft,
  onProof,
  onRestore,
  onEditRecipe,
  onJumpToHeading,
  busy,
}: {
  recipe: RecipeCard;
  content: string;
  revisions: ArticleRevision[];
  /** Drafter-mode articles can be rebuilt from their recipe; pasted ones cannot. */
  isDrafter: boolean;
  jobRunning: boolean;
  onStartDraft: () => void;
  onRedraft: () => void;
  onProof: () => void;
  onRestore: (revisionId: string) => void;
  onEditRecipe: () => void;
  onJumpToHeading: (index: number) => void;
  /** A drafter action is in flight, so every action is disabled. */
  busy: boolean;
}) {
  const [open, setOpen] = useState<SectionId[]>(DEFAULT_OPEN);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_KEY);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) setOpen(parsed as SectionId[]);
    } catch {
      // A browser refusing storage keeps the defaults.
    }
  }, []);

  const toggle = useCallback((id: SectionId) => {
    setOpen((current) => {
      const next = current.includes(id)
        ? current.filter((s) => s !== id)
        : [...current, id];
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // Not remembering the choice is survivable.
      }
      return next;
    });
  }, []);

  const outline = useMemo(() => outlineMap(content), [content]);
  const card = useMemo(() => cardCompleteness(recipe), [recipe]);

  const missingRequired = outline.missing.filter((m) => m.required);
  const disabled = busy || jobRunning;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Article
        </p>
        <p className="mt-0.5 text-[15px] font-semibold leading-tight">
          Source &amp; controls
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ---------------- Generate ---------------- */}
        <Collapsible
          id="generate"
          title="Generate"
          icon={<Wand2 className="size-3.5" aria-hidden />}
          open={open.includes("generate")}
          onToggle={toggle}
          badge={
            jobRunning ? <CountBadge text="running" tone="warn" /> : undefined
          }
        >
          <div className="space-y-2">
            {isDrafter && (
              <Button
                size="sm"
                className="w-full"
                disabled={disabled}
                onClick={onStartDraft}
              >
                {jobRunning ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                {jobRunning ? "Drafting…" : "Draft from recipe"}
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={onRedraft}
              >
                <RotateCw />
                Redraft
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={onProof}
              >
                <Check />
                Proofread
              </Button>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Each run snapshots the current draft first, so nothing you have
              written is lost.
            </p>
          </div>
        </Collapsible>

        {/* ---------------- Sections ---------------- */}
        <Collapsible
          id="sections"
          title="Sections"
          icon={<ListTree className="size-3.5" aria-hidden />}
          open={open.includes("sections")}
          onToggle={toggle}
          badge={
            <CountBadge
              text={`${String(outline.present)}/${String(outline.expected)}`}
              tone={missingRequired.length > 0 ? "warn" : "ok"}
            />
          }
        >
          {outline.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No headings yet. They appear here as the draft is written.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {outline.entries.map((entry) => (
                <li key={`${String(entry.index)}-${entry.heading}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onJumpToHeading(entry.index);
                    }}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent"
                  >
                    <Check
                      className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                    <span className="truncate">{entry.heading}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {outline.missing.length > 0 && (
            <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
              {outline.missing.map((m) => (
                <li
                  key={m.key}
                  className="flex items-center gap-1.5 px-1.5 py-1 text-xs"
                >
                  <AlertTriangle
                    className={cn(
                      "size-3 shrink-0",
                      m.required ? "text-warning" : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <span
                    className={
                      m.required ? "text-foreground" : "text-muted-foreground"
                    }
                  >
                    {m.label}
                  </span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                    {m.required ? "missing" : "optional"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Collapsible>

        {/* ---------------- Recipe ---------------- */}
        <Collapsible
          id="recipe"
          title="Recipe"
          icon={<UtensilsCrossed className="size-3.5" aria-hidden />}
          open={open.includes("recipe")}
          onToggle={toggle}
          badge={
            <CountBadge
              text={`${String(card.filled)}/${String(card.total)}`}
              tone={card.missingRecommended.length > 0 ? "warn" : "ok"}
            />
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                <p className="tabular text-sm font-semibold leading-none">
                  {recipe.ingredients.length}
                </p>
                <p className="mt-1 text-[10px] leading-none text-muted-foreground">
                  Ingredients
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                <p className="tabular text-sm font-semibold leading-none">
                  {recipe.steps.length}
                </p>
                <p className="mt-1 text-[10px] leading-none text-muted-foreground">
                  Instructions
                </p>
              </div>
            </div>

            {/*
              The source, read-only here. It is the one thing in the article
              that must survive every regeneration exactly as typed, so this
              shows it and sends editing to the panel built for it.
            */}
            {recipe.ingredients.length > 0 && (
              <div className="rounded-md border border-border">
                <p className="border-b border-border px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Source ingredients
                </p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto px-2 py-1.5">
                  {recipe.ingredients.map((line, i) => (
                    <li
                      key={`${String(i)}-${line}`}
                      className="text-[11px] leading-snug text-muted-foreground"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <dl className="space-y-1">
              {card.fields.map((f) => (
                <div
                  key={f.key}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <dt
                    className={cn(
                      "shrink-0",
                      f.filled ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {f.label}
                  </dt>
                  <dd
                    className={cn(
                      "min-w-0 truncate text-right",
                      f.filled
                        ? "font-medium"
                        : f.recommended
                          ? "text-warning"
                          : "text-muted-foreground",
                    )}
                  >
                    {f.filled ? f.value : f.recommended ? "Missing" : "—"}
                  </dd>
                </div>
              ))}
            </dl>

            {card.missingRecommended.length > 0 && (
              <p className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                WP Recipe Maker flags these as recommended. Nutrition is not
                listed: WPRM calculates it from the ingredients.
              </p>
            )}

            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={onEditRecipe}
            >
              Edit recipe card
            </Button>
          </div>
        </Collapsible>

        {/* ---------------- History ---------------- */}
        <Collapsible
          id="history"
          title="History"
          icon={<History className="size-3.5" aria-hidden />}
          open={open.includes("history")}
          onToggle={toggle}
          badge={<CountBadge text={String(revisions.length)} />}
        >
          {revisions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Outline, redraft and proofread each leave a snapshot here.
            </p>
          ) : (
            <ul className="space-y-1">
              {[...revisions].reverse().map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium capitalize">{r.kind}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(r.at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={disabled}
                    onClick={() => {
                      onRestore(r.id);
                    }}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Collapsible>
      </div>
    </div>
  );
}
