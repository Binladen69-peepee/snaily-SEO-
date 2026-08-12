"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  PenLine,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BusinessFactsPanel, type Facts } from "@/components/geo/business-facts";
import { DraftEditor } from "@/components/geo/draft-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, ToolPrompt } from "@/components/tool-shell";
import {
  CATEGORY_LABEL,
  MOMENT_LABEL,
  MOMENTS,
  type AnchorPage,
} from "@/lib/geo/config";
import { factsCompleteness } from "@/lib/geo/facts";
import type { GeoIdeaView } from "@/lib/geo/idea";
import { cn } from "@/lib/utils";

export type Idea = GeoIdeaView;

type Signals = {
  paa: number;
  related: number;
  searchConsole: number;
  publishedChecked: number;
};

type MomentFilter = "all" | (typeof MOMENTS)[number]["id"];
type StatusFilter = "all" | "ready" | "drafted" | "redundant";

const MOMENT_TONE: Record<string, string> = {
  want_to_know: "bg-chart-3/12 text-chart-3",
  want_to_go: "bg-success/12 text-success",
  want_to_do: "bg-warning/15 text-warning",
  want_to_buy: "bg-primary/12 text-primary",
};

const STEPS = [
  { n: 1, label: "Ground facts" },
  { n: 2, label: "Map moments" },
  { n: 3, label: "Draft & review" },
] as const;

function LabSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="GEO Lab steps">
      {STEPS.map((step, i) => {
        const done = current > step.n;
        const active = current === step.n;
        return (
          <li key={step.n} className="flex items-center gap-2">
            {i > 0 && (
              <span className="hidden h-px w-6 bg-border sm:block" aria-hidden />
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                active
                  ? "border-primary/40 bg-primary/10 font-medium text-primary"
                  : done
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-border text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              <span className="tabular">{step.n}</span>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function IdeaCard({
  idea,
  selected,
  onToggle,
  onOpen,
  drafting,
}: {
  idea: Idea;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  drafting: boolean;
}) {
  const blocked = idea.redundantWith !== null;
  const drafted = idea.status === "drafted" && idea.draftHtml !== "";

  return (
    <article
      spellCheck={false}
      className={cn(
        "rounded-lg border bg-card p-4 transition-colors",
        blocked
          ? "border-warning/50 opacity-80"
          : selected
            ? "border-primary"
            : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <input
            type="checkbox"
            id={`pick-${idea.id}`}
            checked={selected}
            onChange={onToggle}
            disabled={blocked || drafting || drafted}
            className="mt-0.5 size-4 shrink-0 accent-primary disabled:opacity-40"
          />
          <label
            htmlFor={`pick-${idea.id}`}
            className="min-w-0 cursor-pointer text-sm font-semibold leading-snug"
          >
            {idea.title}
          </label>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {drafted && <Badge variant="success">Drafted</Badge>}
          {blocked && <Badge variant="warning">Redundant</Badge>}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-medium",
              MOMENT_TONE[idea.moment] ?? "bg-muted text-muted-foreground",
            )}
          >
            {MOMENT_LABEL[idea.moment] ?? idea.moment}
          </span>
        </div>
      </div>

      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
        {idea.rationale}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {CATEGORY_LABEL[idea.category] ?? idea.category}
        </span>
        {(idea.attributes ?? []).slice(0, 3).map((a) => (
          <span
            key={a}
            className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {a}
          </span>
        ))}
      </div>

      {blocked && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden />
          Redundant — {idea.redundantWith}
        </p>
      )}

      {(drafting || drafted) && (
        <div className="mt-2.5">
          {drafting && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Drafting…
            </span>
          )}
          {drafted && !drafting && (
            <Button size="sm" variant="outline" onClick={onOpen}>
              <FileText />
              Open draft
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export function GeoLabView({
  projectId,
  initialFacts,
  initialIdeas,
  anchorPages,
}: {
  projectId: string;
  initialFacts: Facts;
  initialIdeas: Idea[];
  anchorPages: AnchorPage[];
}) {
  const [facts, setFacts] = useState(initialFacts);
  const [ideas, setIdeas] = useState(initialIdeas);
  const [seed, setSeed] = useState("");
  const [anchorId, setAnchorId] = useState(anchorPages[0]?.id ?? "catering");
  const [busy, setBusy] = useState(false);
  const [showFacts, setShowFacts] = useState(
    initialFacts.serviceArea.trim() === "",
  );
  const [signals, setSignals] = useState<Signals | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [drafting, setDrafting] = useState<string | null>(null);
  const [draftProgress, setDraftProgress] = useState<{
    current: number;
    total: number;
    title: string;
  } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [momentFilter, setMomentFilter] = useState<MomentFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const factsReady = facts.serviceArea.trim() !== "";
  const completeness = factsCompleteness(facts);
  const currentStep: 1 | 2 | 3 = !factsReady ? 1 : ideas.length === 0 ? 2 : 3;

  const draftedCount = ideas.filter(
    (i) => i.status === "drafted" && i.draftHtml !== "",
  ).length;
  const redundantCount = ideas.filter((i) => i.redundantWith !== null).length;
  const readyCount = ideas.length - redundantCount - draftedCount;

  const visible = useMemo(() => {
    return ideas.filter((i) => {
      if (momentFilter !== "all" && i.moment !== momentFilter) return false;
      const drafted = i.status === "drafted" && i.draftHtml !== "";
      const redundant = i.redundantWith !== null;
      if (statusFilter === "drafted") return drafted;
      if (statusFilter === "redundant") return redundant;
      if (statusFilter === "ready") return !drafted && !redundant;
      return true;
    });
  }, [ideas, momentFilter, statusFilter]);

  const selectable = visible.filter(
    (i) =>
      i.redundantWith === null &&
      !(i.status === "drafted" && i.draftHtml !== ""),
  );
  const pickedCount = selectable.filter((i) => picked.has(i.id)).length;
  const open = ideas.find((i) => i.id === openId) ?? null;

  async function mapMoments() {
    if (seed.trim() === "") return;
    setBusy(true);
    setSignals(null);

    try {
      const res = await fetch("/api/geo/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, seed, anchorPageId: anchorId }),
      });
      const data = (await res.json()) as {
        ideas?: Idea[];
        signals?: { paa: number; related: number; searchConsole: number };
        publishedChecked?: number;
        error?: string;
        needsFacts?: boolean;
      };

      if (!res.ok || !data.ideas) {
        toast.error(data.error ?? "Could not map moments");
        if (data.needsFacts === true) setShowFacts(true);
        return;
      }

      setIdeas(data.ideas);
      setPicked(new Set());
      setOpenId(null);
      setMomentFilter("all");
      setStatusFilter("all");
      const s = data.signals;
      setSignals(
        s
          ? {
              paa: s.paa,
              related: s.related,
              searchConsole: s.searchConsole,
              publishedChecked: data.publishedChecked ?? 0,
            }
          : null,
      );
      toast.success(`Mapped ${String(data.ideas.length)} moments`);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  async function draftSelected() {
    const targets = ideas.filter(
      (i) =>
        picked.has(i.id) &&
        i.redundantWith === null &&
        !(i.status === "drafted" && i.draftHtml !== ""),
    );
    if (targets.length === 0) return;

    setBusy(true);
    let done = 0;

    for (let n = 0; n < targets.length; n++) {
      const target = targets[n]!;
      setDrafting(target.id);
      setDraftProgress({
        current: n + 1,
        total: targets.length,
        title: target.title,
      });
      try {
        const res = await fetch(`/api/geo/idea/${target.id}`, { method: "POST" });
        const data = (await res.json()) as {
          idea?: Idea;
          error?: string;
          needsFacts?: boolean;
          redundant?: boolean;
        };

        if (!res.ok || !data.idea) {
          toast.error(data.error ?? `Could not draft “${target.title}”`);
          if (data.needsFacts === true) setShowFacts(true);
          if (data.redundant === true) {
            setIdeas((prev) =>
              prev.map((i) =>
                i.id === target.id
                  ? { ...i, redundantWith: data.error ?? "Duplicate" }
                  : i,
              ),
            );
          }
          continue;
        }

        const saved = data.idea;
        setIdeas((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
        setPicked((prev) => {
          const next = new Set(prev);
          next.delete(saved.id);
          return next;
        });
        setOpenId(saved.id);
        done += 1;
      } catch {
        toast.error("Could not reach the server");
      }
    }

    setDrafting(null);
    setDraftProgress(null);
    setBusy(false);
    if (done > 0) {
      toast.success(
        done === 1
          ? "Draft ready for review"
          : `${String(done)} drafts ready for review`,
      );
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="GEO Lab"
        description="Map a topic into article ideas, then draft the ones you pick."
      >
        <Badge variant={factsReady ? "success" : "warning"}>
          Facts {completeness.filled}/{completeness.total}
        </Badge>
        <Button
          variant={showFacts ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setShowFacts((v) => !v);
          }}
        >
          <Settings2 />
          Business Facts
        </Button>
      </PageHeader>

      <LabSteps current={currentStep} />

      {showFacts && (
        <BusinessFactsPanel
          projectId={projectId}
          initial={facts}
          onSaved={(next) => {
            setFacts(next);
          }}
        />
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
          <div className="space-y-1.5">
            <Label htmlFor="geo-seed">What are you trying to get found for?</Label>
            <Input
              id="geo-seed"
              value={seed}
              onChange={(e) => {
                setSeed(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy && seed.trim() !== "" && factsReady) {
                  e.preventDefault();
                  void mapMoments();
                }
              }}
              placeholder="NJ vegan caterer"
              className="h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="geo-anchor">Which page should this support?</Label>
            <select
              id="geo-anchor"
              value={anchorId}
              onChange={(e) => {
                setAnchorId(e.target.value);
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {anchorPages.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void mapMoments()}
            disabled={busy || seed.trim() === "" || !factsReady}
          >
            {busy && drafting === null ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            {busy && drafting === null ? "Mapping…" : "Map the Moments"}
          </Button>
          {!factsReady && (
            <span className="text-xs text-warning">
              Fill in Business Facts first — ideas are grounded in them, not guessed.
            </span>
          )}
        </div>
      </section>

      {signals !== null && (
        <p className="text-xs text-muted-foreground">
          Mapped from {signals.paa} People Also Ask, {signals.related} related
          searches
          {signals.searchConsole > 0
            ? `, ${signals.searchConsole} Search Console queries`
            : ""}
          {signals.publishedChecked > 0
            ? `, ${signals.publishedChecked} published posts checked`
            : ""}
          .
        </p>
      )}

      {ideas.length === 0 && !busy && (
        <ToolPrompt icon={Sparkles} title="Map a topic to get started">
          Enter what you want to be found for. GEO Lab reads live People Also
          Ask, related searches, and Search Console queries, then proposes
          articles at the intersection of a buyer moment and a trust category.
        </ToolPrompt>
      )}

      {ideas.length > 0 && (
        <>
          <div className="space-y-3 rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => void draftSelected()}
                disabled={busy || pickedCount === 0 || !factsReady}
              >
                {drafting !== null ? <Loader2 className="animate-spin" /> : <PenLine />}
                {drafting !== null
                  ? "Drafting…"
                  : `Draft ${pickedCount === 0 ? "selected" : String(pickedCount)}`}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || selectable.length === 0}
                onClick={() => {
                  setPicked(
                    pickedCount === selectable.length
                      ? new Set()
                      : new Set(selectable.map((i) => i.id)),
                  );
                }}
              >
                {pickedCount === selectable.length ? "Clear all" : "Select all"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {Math.max(0, readyCount)} ready · {draftedCount} drafted
                {redundantCount > 0 ? ` · ${redundantCount} redundant` : ""}
              </span>
              {draftProgress !== null && (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  {draftProgress.current} of {draftProgress.total}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filters">
              <FilterChip
                active={momentFilter === "all"}
                onClick={() => {
                  setMomentFilter("all");
                }}
              >
                All moments
              </FilterChip>
              {MOMENTS.map((m) => (
                <FilterChip
                  key={m.id}
                  active={momentFilter === m.id}
                  onClick={() => {
                    setMomentFilter(m.id);
                  }}
                >
                  {m.label}
                </FilterChip>
              ))}
              <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
              {(
                [
                  ["all", "All"],
                  ["ready", "Ready"],
                  ["drafted", "Drafted"],
                  ["redundant", "Redundant"],
                ] as const
              ).map(([id, label]) => (
                <FilterChip
                  key={id}
                  active={statusFilter === id}
                  onClick={() => {
                    setStatusFilter(id);
                  }}
                >
                  {label}
                </FilterChip>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <ToolPrompt icon={CheckCircle2} title="Nothing matches these filters">
              Clear the moment or status filter to see the rest of this mapping.
            </ToolPrompt>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {visible.map((i) => (
                <IdeaCard
                  key={i.id}
                  idea={i}
                  selected={picked.has(i.id)}
                  drafting={drafting === i.id}
                  onOpen={() => {
                    setOpenId(i.id);
                  }}
                  onToggle={() => {
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(i.id)) next.delete(i.id);
                      else next.add(i.id);
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {open !== null && open.draftHtml !== "" && (
        <DraftEditor
          key={open.id}
          idea={open}
          onClose={() => {
            setOpenId(null);
          }}
          onSaved={(saved) => {
            setIdeas((prev) =>
              prev.map((i) => (i.id === saved.id ? { ...i, ...saved } : i)),
            );
          }}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Drafts stay in the lab until you copy them out. Nothing publishes on its
        own.
      </p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
