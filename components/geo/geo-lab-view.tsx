"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  PenLine,
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
import {
  CATEGORY_LABEL,
  MOMENT_LABEL,
  TRUST_CATEGORIES,
  type AnchorPage,
} from "@/lib/geo/config";
import type { GeoIdeaView } from "@/lib/geo/idea";
import {
  buildGeoScoreReport,
  buildRedundancyPairs,
  metricStatusLabel,
  MOMENT_DISPLAY,
  type GeoMetric,
  type GeoStageId,
} from "@/lib/geo/score";
import { cn } from "@/lib/utils";

export type Idea = GeoIdeaView;

type Signals = {
  paa: number;
  related: number;
  searchConsole: number;
  publishedChecked: number;
  /** Which provider answered. Null when neither was configured. */
  provider?: string | null;
  cached?: boolean;
};

const STAGES: { id: GeoStageId; label: string; short: string }[] = [
  { id: "overview", label: "Overview", short: "Overview" },
  { id: "knowledge", label: "Business Knowledge", short: "Knowledge" },
  { id: "redundancy", label: "Content & Redundancy", short: "Redundancy" },
  { id: "moments", label: "Search Moments", short: "Moments" },
  { id: "trust", label: "Trust & Citation", short: "Trust" },
  { id: "opportunities", label: "AI Opportunities", short: "Opps" },
  { id: "draft", label: "Draft & Review", short: "Draft" },
  { id: "export", label: "Export", short: "Export" },
];

const MOMENT_TONE: Record<string, string> = {
  want_to_know: "bg-chart-3/12 text-chart-3",
  want_to_go: "bg-success/12 text-success",
  want_to_do: "bg-warning/15 text-warning",
  want_to_buy: "bg-primary/12 text-primary",
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-destructive",
  high: "bg-warning",
  medium: "bg-chart-3",
  low: "bg-success",
};

const DRAFT_STEPS = [
  "Analyzing search intent",
  "Building outline",
  "Writing content",
  "Generating FAQ",
  "Generating metadata",
  "Running quality checks",
] as const;

function ScoreRing({ score, size = 56 }: { score: number | null; size?: number }) {
  const v = score ?? 0;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, v)) / 100) * c;
  const color =
    score === null
      ? "stroke-muted"
      : score >= 80
        ? "stroke-success"
        : score >= 50
          ? "stroke-warning"
          : "stroke-destructive";

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className="stroke-muted"
        strokeWidth={4}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className={color}
        strokeWidth={4}
        strokeDasharray={c}
        strokeDashoffset={score === null ? c : offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

function MetricCard({ m }: { m: GeoMetric }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[11px]">
            {m.label}
          </p>
          <p className="tabular mt-0.5 text-xl font-semibold sm:mt-1 sm:text-2xl">
            {m.score === null ? (
              <span className="text-base text-muted-foreground sm:text-2xl">N/A</span>
            ) : (
              <>
                {m.score}
                <span className="text-xs font-normal text-muted-foreground sm:text-sm">
                  /100
                </span>
              </>
            )}
          </p>
          <Badge
            variant={
              m.status === "strong" || m.status === "good"
                ? "success"
                : m.status === "fair"
                  ? "warning"
                  : m.status === "weak"
                    ? "destructive"
                    : "secondary"
            }
            className="mt-1 sm:mt-1.5"
          >
            {metricStatusLabel(m.status)}
          </Badge>
        </div>
        <div className="hidden sm:block">
          <ScoreRing score={m.score} size={48} />
        </div>
      </div>
      <p className="mt-2 hidden text-[11px] leading-relaxed text-muted-foreground sm:line-clamp-2 lg:block">
        {m.explanation}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {m.delta === null
          ? "No previous scan"
          : `${m.delta > 0 ? "+" : ""}${String(m.delta)} since last scan`}
      </p>
      {m.score !== null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              m.score >= 80
                ? "bg-success"
                : m.score >= 50
                  ? "bg-warning"
                  : "bg-destructive",
            )}
            style={{ width: `${String(m.score)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function GeoLabView({
  projectId,
  initialFacts,
  initialIdeas,
  anchorPages,
  gscConnected = false,
  projectName = "Your site",
}: {
  projectId: string;
  initialFacts: Facts;
  initialIdeas: Idea[];
  anchorPages: AnchorPage[];
  gscConnected?: boolean;
  projectName?: string;
}) {
  const [facts, setFacts] = useState(initialFacts);
  const [ideas, setIdeas] = useState(initialIdeas);
  const [stage, setStage] = useState<GeoStageId>("overview");
  const [seed, setSeed] = useState("");
  const [anchorId, setAnchorId] = useState(anchorPages[0]?.id ?? "catering");
  const [busy, setBusy] = useState(false);
  const [signals, setSignals] = useState<Signals | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [drafting, setDrafting] = useState<string | null>(null);
  const [draftStep, setDraftStep] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);
  const [oppFilter, setOppFilter] = useState<
    "all" | "high" | "missing" | "existing" | "redundant"
  >("all");

  const report = useMemo(() => buildGeoScoreReport(facts, ideas), [facts, ideas]);
  const redundancyPairs = useMemo(() => buildRedundancyPairs(ideas), [ideas]);
  const factsReady = facts.serviceArea.trim() !== "";
  const open = ideas.find((i) => i.id === openId) ?? null;

  const opportunities = useMemo(() => {
    return ideas.filter((i) => {
      const drafted = i.status === "drafted" && i.draftHtml !== "";
      const redundant = i.redundantWith !== null;
      if (oppFilter === "high")
        return (
          !redundant &&
          !drafted &&
          (i.moment === "want_to_buy" || i.moment === "want_to_do")
        );
      if (oppFilter === "missing") return !drafted && !redundant;
      if (oppFilter === "existing") return drafted;
      if (oppFilter === "redundant") return redundant;
      return true;
    });
  }, [ideas, oppFilter]);

  const selectable = ideas.filter(
    (i) =>
      i.redundantWith === null &&
      !(i.status === "drafted" && i.draftHtml !== ""),
  );
  const pickedCount = selectable.filter((i) => picked.has(i.id)).length;

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
        if (data.needsFacts === true) setStage("knowledge");
        return;
      }
      setIdeas(data.ideas);
      setPicked(new Set());
      setOpenId(null);
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
      setStage("moments");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  async function draftOne(id: string) {
    setBusy(true);
    setDrafting(id);
    setDraftStep(0);
    const tick = window.setInterval(() => {
      setDraftStep((s) => Math.min(s + 1, DRAFT_STEPS.length - 1));
    }, 2200);

    try {
      const res = await fetch(`/api/geo/idea/${id}`, { method: "POST" });
      const data = (await res.json()) as {
        idea?: Idea;
        error?: string;
        needsFacts?: boolean;
        redundant?: boolean;
      };
      if (!res.ok || !data.idea) {
        toast.error(data.error ?? "Could not draft");
        if (data.needsFacts === true) setStage("knowledge");
        if (data.redundant === true) {
          setIdeas((prev) =>
            prev.map((i) =>
              i.id === id
                ? { ...i, redundantWith: data.error ?? "Duplicate" }
                : i,
            ),
          );
        }
        return;
      }
      setDraftStep(DRAFT_STEPS.length);
      const saved = data.idea;
      setIdeas((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
      setPicked((prev) => {
        const next = new Set(prev);
        next.delete(saved.id);
        return next;
      });
      setOpenId(saved.id);
      setStage("draft");
      toast.success("Draft ready");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      window.clearInterval(tick);
      setDrafting(null);
      setDraftStep(0);
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
    for (const t of targets) {
      await draftOne(t.id);
    }
  }

  const previewFacts = [
    facts.serviceArea && `Serves: ${facts.serviceArea}`,
    facts.eventTypes && `Events: ${facts.eventTypes}`,
    facts.dietaryHandling && `Dietary: ${facts.dietaryHandling}`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 overflow-x-clip sm:space-y-5">
      {/* Header */}
      <header className="rounded-2xl border border-border bg-card p-3 sm:p-4 md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
              GEO Lab
            </p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight sm:text-xl md:text-2xl">
              AI Search Visibility Command Center
            </h1>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
              Discover → Analyze → Prioritize → Create → Review → Export
            </p>
          </div>
          <div className="flex w-full shrink-0 items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 sm:w-auto">
            <ScoreRing score={report.visibility.score} size={44} />
            <div className="min-w-0">
              <p className="text-[10px] uppercase text-muted-foreground">
                GEO Visibility
              </p>
              <p className="tabular text-xl font-semibold">
                {report.visibility.score === null
                  ? "—"
                  : `${String(report.visibility.score)}/100`}
              </p>
              <p className="text-[10px] text-muted-foreground">No previous scan</p>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard m={report.visibility} />
          <MetricCard m={report.aiReadiness} />
          <MetricCard m={report.contentCoverage} />
          <MetricCard m={report.factsCompleteness} />
          <MetricCard m={report.trustSignals} />
          <MetricCard m={report.redundancyRisk} />
        </div>
      </header>

      {/* Workflow nav */}
      <nav
        aria-label="GEO workflow"
        className="scroll-x -mx-3 flex snap-x snap-mandatory gap-1 px-3 pb-1 sm:-mx-0 sm:px-0"
      >
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setStage(s.id);
            }}
            className={cn(
              "shrink-0 snap-start rounded-lg border px-2.5 py-1.5 text-xs transition-colors sm:px-3",
              stage === s.id
                ? "border-primary/40 bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="md:hidden">{s.short}</span>
            <span className="hidden md:inline">{s.label}</span>
          </button>
        ))}
      </nav>

      {/* OVERVIEW */}
      {stage === "overview" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">What should I do next?</h2>
            <p className="text-xs text-muted-foreground">
              Highest-impact actions from your real GEO data — never fabricated.
            </p>
            {report.nextActions.length === 0 ? (
              <p className="mt-3 text-sm text-success">
                No urgent actions. Fill facts or map a topic to unlock recommendations.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {report.nextActions.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center"
                  >
                    <span
                      className={cn("mt-1 size-2.5 shrink-0 rounded-full sm:mt-0", SEVERITY_DOT[a.severity])}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">{a.detail}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => {
                        setStage(a.stage);
                      }}
                    >
                      {a.cta}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">GEO Score breakdown</h2>
                <p className="text-xs text-muted-foreground">
                  Transparent math from stored facts and ideas only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowHow((v) => !v);
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                How is this calculated?
                {showHow ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["Business Facts", report.breakdown.businessFacts],
                  ["Content Coverage", report.breakdown.contentCoverage],
                  ["Search Moment Coverage", report.breakdown.searchMomentCoverage],
                  ["Trust Signals", report.breakdown.trustSignals],
                  ["Redundancy health", report.breakdown.redundancy],
                  ["Citation Readiness", report.breakdown.citationReadiness],
                ] as const
              ).map(([label, score]) => (
                <div
                  key={label}
                  className="rounded-lg border border-border bg-background px-3 py-2"
                >
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="tabular text-lg font-semibold">
                    {score === null ? (
                      <span className="text-sm text-muted-foreground">
                        Not enough data
                      </span>
                    ) : (
                      `${String(score)}%`
                    )}
                  </p>
                </div>
              ))}
            </div>

            {showHow && (
              <ul className="mt-3 space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
                {report.howCalculated.map((h) => (
                  <li key={h.label}>
                    <strong className="text-foreground">{h.label}:</strong> {h.detail}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-dashed border-border p-4">
            <h2 className="text-sm font-semibold">GEO Progress</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Run another scan to compare progress. No previous scan is stored yet.
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Generated preview</Badge>
              <h2 className="text-sm font-semibold">AI-style answer preview</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Not a live ChatGPT / Google AI ranking. Built from your Business Facts
              and drafted ideas only.
            </p>
            <div className="mt-3 rounded-lg border border-border bg-background p-3 text-sm">
              <p className="font-medium">{projectName}</p>
              <p className="mt-2 text-muted-foreground">
                {previewFacts.length > 0
                  ? previewFacts.join(" · ")
                  : "Add Business Facts to ground this preview."}
              </p>
              {report.counts.drafted > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Supporting drafts on file: {report.counts.drafted}. Cited pages
                  appear after you export drafts to WordPress.
                </p>
              )}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              REAL DATA: Business Facts · GENERATED PREVIEW: answer framing
            </p>
          </section>
        </div>
      )}

      {/* KNOWLEDGE */}
      {stage === "knowledge" && (
        <BusinessFactsPanel
          projectId={projectId}
          initial={facts}
          onSaved={(next) => {
            setFacts(next);
          }}
        />
      )}

      {/* REDUNDANCY */}
      {stage === "redundancy" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Redundancy Radar</h2>
            <p className="text-xs text-muted-foreground">
              Deterministic Jaccard overlap with place-name normalization. City-swap
              duplicates are blocked. Threshold: 60% similarity.
            </p>
          </div>

          {redundancyPairs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-12 text-center">
              <CheckCircle2 className="mx-auto size-8 text-success" />
              <p className="mt-2 font-medium">No redundancy detected</p>
              <p className="text-sm text-muted-foreground">
                Map moments to check ideas against published posts and siblings.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {redundancyPairs.map((pair) => (
                <li
                  key={pair.a.id}
                  className="rounded-xl border border-warning/40 bg-card p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">HIGH risk</Badge>
                    <span className="text-xs text-muted-foreground">
                      Flagged by redundancy check
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium">{pair.a.title}</p>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    {pair.reason}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Why: overlapping intent after place-name stripping, or already
                    published under a similar title.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOppFilter("redundant");
                        setStage("opportunities");
                      }}
                    >
                      View in planner
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* MOMENTS */}
      {stage === "moments" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Search Moment Map</h2>
            <p className="text-xs text-muted-foreground">
              Map a seed against live PAA, related searches, and Search Console
              (when connected).
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
              <div className="space-y-1.5">
                <Label htmlFor="geo-seed">Seed topic</Label>
                <Input
                  id="geo-seed"
                  value={seed}
                  onChange={(e) => {
                    setSeed(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !busy &&
                      seed.trim() !== "" &&
                      factsReady
                    ) {
                      e.preventDefault();
                      void mapMoments();
                    }
                  }}
                  placeholder="NJ vegan caterer"
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="geo-anchor">Anchor page</Label>
                <select
                  id="geo-anchor"
                  value={anchorId}
                  onChange={(e) => {
                    setAnchorId(e.target.value);
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {(facts.anchorPages.length > 0
                    ? facts.anchorPages
                    : anchorPages
                  ).map((a) => (
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
                Map the Moments
              </Button>
              {!factsReady && (
                <span className="text-xs text-warning">
                  Fill Business Facts first (service area required).
                </span>
              )}
              {!gscConnected && (
                <span className="text-xs text-muted-foreground">
                  Search Console not connected — PAA and related searches still
                  come from DataForSEO.
                </span>
              )}
            </div>

            {signals !== null && (
              <p className="mt-3 text-xs text-muted-foreground">
                Provenance: {signals.provider ?? "No SERP provider"}
                {signals.cached === true ? " (cached)" : ""} · PAA {signals.paa} ·
                Related {signals.related}
                {signals.searchConsole > 0
                  ? ` · GSC ${signals.searchConsole}`
                  : gscConnected
                    ? " · GSC 0 matching queries"
                    : " · GSC unavailable"}
                {signals.publishedChecked > 0
                  ? ` · ${signals.publishedChecked} published posts checked`
                  : ""}
              </p>
            )}
          </section>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {report.momentBuckets.map((b) => (
              <div
                key={b.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {b.displayLabel}
                </p>
                <p className="tabular mt-1 text-2xl font-semibold">{b.count}</p>
                <p className="text-xs text-muted-foreground">
                  {b.highPriority} high-intent · {b.drafted} drafted
                  {b.redundant > 0 ? ` · ${b.redundant} redundant` : ""}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Spec moment: {b.label}
                </p>
              </div>
            ))}
          </div>

          {ideas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              No moments mapped yet.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {ideas.slice(0, 12).map((i) => (
                <IdeaMini
                  key={i.id}
                  idea={i}
                  onDraft={() => void draftOne(i.id)}
                  onOpen={() => {
                    setOpenId(i.id);
                    setStage("draft");
                  }}
                  drafting={drafting === i.id}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* TRUST */}
      {stage === "trust" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Trust & Citation Signals</h2>
            <p className="text-xs text-muted-foreground">
              The six fixed trust-content categories. Coverage comes from mapped
              ideas — not invented topics.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST_CATEGORIES.map((c) => {
              const count = ideas.filter(
                (i) => i.category === c.id && i.redundantWith === null,
              ).length;
              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{c.label}</p>
                    <Badge variant={count > 0 ? "success" : "secondary"}>
                      {count}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.brief}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* OPPORTUNITIES */}
      {stage === "opportunities" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">AI Citation Opportunities</h2>
            <p className="text-xs text-muted-foreground">
              Topics where clearer, more authoritative answers can help AI/search
              systems cite your site. Built from mapped ideas only.
            </p>
            {!gscConnected && (
              <p className="mt-2 text-xs text-warning">
                Search Console not connected — GSC-sourced opportunities unavailable.
              </p>
            )}
          </div>

          <div className="scroll-x flex gap-1.5 pb-1">
            {(
              [
                ["all", "All"],
                ["high", "High priority"],
                ["missing", "Missing content"],
                ["existing", "Existing drafts"],
                ["redundant", "Redundant"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setOppFilter(id);
                }}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-xs",
                  oppFilter === id
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void draftSelected()}
              disabled={busy || pickedCount === 0 || !factsReady}
            >
              {drafting !== null ? <Loader2 className="animate-spin" /> : <PenLine />}
              Draft {pickedCount === 0 ? "selected" : String(pickedCount)}
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
              {pickedCount === selectable.length ? "Clear all" : "Select all ready"}
            </Button>
          </div>

          {/* Desktop table */}
          <div className="scroll-x hidden rounded-xl border border-border md:block">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 w-8" />
                  <th className="px-3 py-2.5">Topic</th>
                  <th className="px-3 py-2.5">Intent</th>
                  <th className="px-3 py-2.5">Trust</th>
                  <th className="px-3 py-2.5">Priority</th>
                  <th className="px-3 py-2.5">Coverage</th>
                  <th className="px-3 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {opportunities.map((i) => {
                  const drafted = i.status === "drafted" && i.draftHtml !== "";
                  const redundant = i.redundantWith !== null;
                  const high =
                    i.moment === "want_to_buy" || i.moment === "want_to_do";
                  return (
                    <tr key={i.id} className="hover:bg-accent/30">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={picked.has(i.id)}
                          disabled={redundant || drafted || busy}
                          onChange={() => {
                            setPicked((prev) => {
                              const next = new Set(prev);
                              if (next.has(i.id)) next.delete(i.id);
                              else next.add(i.id);
                              return next;
                            });
                          }}
                          className="accent-primary"
                          aria-label={`Select ${i.title}`}
                        />
                      </td>
                      <td className="max-w-xs px-3 py-2.5">
                        <p className="truncate font-medium">{i.title}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {i.rationale}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[11px] font-medium",
                            MOMENT_TONE[i.moment],
                          )}
                        >
                          {MOMENT_DISPLAY[i.moment] ?? MOMENT_LABEL[i.moment]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {CATEGORY_LABEL[i.category] ?? i.category}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant={high ? "warning" : "secondary"}>
                          {high ? "High" : "Medium"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        {redundant ? (
                          <Badge variant="warning">Redundant</Badge>
                        ) : drafted ? (
                          <Badge variant="success">Drafted</Badge>
                        ) : (
                          <Badge variant="outline">Missing</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          {!drafted && !redundant && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void draftOne(i.id)}
                            >
                              Draft
                            </Button>
                          )}
                          {drafted && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setOpenId(i.id);
                                setStage("draft");
                              }}
                            >
                              View
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {opportunities.map((i) => (
              <IdeaMini
                key={i.id}
                idea={i}
                selected={picked.has(i.id)}
                onToggle={() => {
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(i.id)) next.delete(i.id);
                    else next.add(i.id);
                    return next;
                  });
                }}
                onDraft={() => void draftOne(i.id)}
                onOpen={() => {
                  setOpenId(i.id);
                  setStage("draft");
                }}
                drafting={drafting === i.id}
                busy={busy}
              />
            ))}
          </div>

          {opportunities.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No opportunities match this filter.
            </p>
          )}
        </section>
      )}

      {/* DRAFT */}
      {stage === "draft" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Draft & Review</h2>
            <p className="text-xs text-muted-foreground">
              Multi-stage pipeline: Outline → Prose → FAQ → Metadata → Self-QA.
              Never a single AI call.
            </p>
          </div>

          {drafting !== null && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm font-medium">Generating draft…</p>
              <ol className="mt-3 space-y-1.5 text-sm">
                {DRAFT_STEPS.map((label, idx) => {
                  const done = draftStep > idx;
                  const active = draftStep === idx;
                  return (
                    <li key={label} className="flex items-center gap-2">
                      {done ? (
                        <CheckCircle2 className="size-4 text-success" />
                      ) : active ? (
                        <Loader2 className="size-4 animate-spin text-primary" />
                      ) : (
                        <span className="size-4 rounded-full border border-border" />
                      )}
                      <span className={done || active ? "" : "text-muted-foreground"}>
                        {label}
                      </span>
                    </li>
                  );
                })}
                {draftStep >= DRAFT_STEPS.length && (
                  <li className="flex items-center gap-2 font-medium text-success">
                    <CheckCircle2 className="size-4" />
                    Draft ready
                  </li>
                )}
              </ol>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Drafter</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Weighted keyword coverage (75% weight = 100% score) lives in Drafter
              with a SERP brief. GEO drafts do not invent term weights —
              open Drafter with a keyword brief for that score.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Content Optimization:{" "}
              <strong className="text-foreground">N/A</strong> — keyword brief
              required
            </p>
          </div>

          {report.counts.drafted === 0 && drafting === null ? (
            <div className="rounded-xl border border-dashed border-border py-12 text-center">
              <FileText className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-2 font-medium">No drafts yet</p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => {
                  setStage("opportunities");
                }}
              >
                Go to opportunities
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {ideas
                .filter((i) => i.status === "drafted" && i.draftHtml !== "")
                .map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => {
                      setOpenId(i.id);
                    }}
                    className="rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40"
                  >
                    <p className="font-medium">{i.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {MOMENT_DISPLAY[i.moment]} · {CATEGORY_LABEL[i.category]}
                      {i.faq.length > 0 ? ` · ${i.faq.length} FAQ` : ""}
                    </p>
                    {i.qaNotes && (
                      <p className="mt-2 flex items-start gap-1 text-[11px] text-warning">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                        QA notes present — review before export
                      </p>
                    )}
                  </button>
                ))}
            </div>
          )}
        </section>
      )}

      {/* EXPORT */}
      {stage === "export" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Export</h2>
            <p className="text-xs text-muted-foreground">
              Drafts stay in the lab until you copy them. Nothing publishes on its
              own. Use “Copy for WordPress” in the draft editor.
            </p>
          </div>
          {report.counts.drafted === 0 ? (
            <p className="text-sm text-muted-foreground">
              No drafted articles ready to export.
            </p>
          ) : (
            <ul className="space-y-2">
              {ideas
                .filter((i) => i.status === "drafted" && i.draftHtml !== "")
                .map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{i.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        slug: {i.slug || "—"} · meta {i.metaTitle.length}/60
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setOpenId(i.id);
                      }}
                    >
                      Open & copy
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </section>
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
    </div>
  );
}

function IdeaMini({
  idea,
  selected,
  onToggle,
  onDraft,
  onOpen,
  drafting,
  busy,
}: {
  idea: Idea;
  selected?: boolean;
  onToggle?: () => void;
  onDraft: () => void;
  onOpen: () => void;
  drafting: boolean;
  busy: boolean;
}) {
  const blocked = idea.redundantWith !== null;
  const drafted = idea.status === "drafted" && idea.draftHtml !== "";
  const high = idea.moment === "want_to_buy" || idea.moment === "want_to_do";

  return (
    <article
      spellCheck={false}
      className={cn(
        "rounded-xl border bg-card p-4",
        blocked ? "border-warning/50" : "border-border",
      )}
    >
      <div className="flex items-start gap-2">
        {onToggle && (
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={onToggle}
            disabled={blocked || drafted || busy}
            className="mt-1 accent-primary"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{idea.title}</p>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {idea.rationale}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-medium",
                MOMENT_TONE[idea.moment],
              )}
            >
              {MOMENT_DISPLAY[idea.moment] ?? MOMENT_LABEL[idea.moment]}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {CATEGORY_LABEL[idea.category]}
            </span>
            {high && <Badge variant="warning">High intent</Badge>}
            {drafted && <Badge variant="success">Drafted</Badge>}
            {blocked && <Badge variant="warning">Redundant</Badge>}
          </div>
          {idea.attributes.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Target attributes: {idea.attributes.slice(0, 4).join(", ")}
            </p>
          )}
          {idea.anchorText && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Natural anchor: “{idea.anchorText}”
            </p>
          )}
          {blocked && (
            <p className="mt-2 text-[11px] text-warning">{idea.redundantWith}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!blocked && !drafted && (
              <Button size="sm" disabled={busy} onClick={onDraft}>
                {drafting ? <Loader2 className="animate-spin" /> : <PenLine />}
                Generate Draft
              </Button>
            )}
            {drafted && (
              <Button size="sm" variant="outline" onClick={onOpen}>
                <FileText />
                View Details
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
