"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDashed,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

import { GapBars, ImpactEffortMatrix, Meter, RangeBar } from "@/components/foresight/charts";
import { FigureValue, ProvenanceChip } from "@/components/foresight/figure-value";
import { quadrantFor } from "@/lib/foresight/plan";
import { cn } from "@/lib/utils";
import {
  QUADRANT_LABEL,
  REACHABILITY_LABEL,
  type Forecast,
  type KeywordProjection,
  type Opportunity,
  type PlanAction,
  type Readiness,
  type ReachabilityBand,
} from "@/lib/foresight/types";

/* -------------------------------------------------------------------------
 * Section heading — the rhythm the old page had none of
 * ---------------------------------------------------------------------- */

export function SectionHead({
  eyebrow,
  title,
  note,
  right,
}: {
  eyebrow: string;
  title: string;
  note?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
          {eyebrow}
        </p>
        <h2 className="mt-0.5 text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
        {note !== undefined && (
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{note}</p>
        )}
      </div>
      {right}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Readiness
 * ---------------------------------------------------------------------- */

export function ReadinessPanel({ readiness }: { readiness: Readiness }) {
  const [open, setOpen] = useState(false);

  const passed = readiness.checks.filter((c) => c.status === "pass").length;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
        <div className="min-w-0 shrink-0 sm:w-44">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Forecast readiness
          </p>
          <p className="mt-1 text-[2rem] font-semibold leading-none">{readiness.score}%</p>
          <Meter
            value={readiness.score}
            className="mt-2"
            caption={`${String(passed)} of ${String(readiness.checks.length)} checks pass`}
          />
        </div>

        <div className="min-w-0 flex-1">
          {readiness.limitation !== null ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {readiness.limitation}
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Every input this model wants is available for this project.
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v);
            }}
            aria-expanded={open}
            className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
          >
            {open ? "Hide" : "See"} the {readiness.checks.length} checks
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {open && (
        <ul className="grid gap-x-6 gap-y-3 border-t border-border p-4 sm:grid-cols-2 sm:p-5">
          {readiness.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 shrink-0">
                {c.status === "pass" ? (
                  <Check className="size-4 text-success" aria-hidden />
                ) : c.status === "warn" ? (
                  <AlertTriangle className="size-4 text-warning" aria-hidden />
                ) : (
                  <CircleDashed className="size-4 text-destructive" aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className="block text-[12px] leading-snug text-muted-foreground">
                  {c.detail}
                </span>
                {c.fix !== undefined && (
                  <Link
                    href={c.fix.href}
                    className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
                  >
                    {c.fix.label}
                    <ExternalLink className="size-3" aria-hidden />
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Opportunities
 * ---------------------------------------------------------------------- */

const EFFORT_TONE = {
  low: "bg-success/12 text-success",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/12 text-destructive",
} as const;

const KIND_LABEL: Record<string, string> = {
  "striking-distance": "Striking distance",
  "low-ctr": "Low click-through",
  "content-gap": "Content gap",
  cannibalization: "Cannibalisation",
  "internal-links": "Internal links",
  technical: "Technical",
  "serp-feature": "SERP feature",
};

export function OpportunityCards({ items }: { items: Opportunity[] }) {
  const [limit, setLimit] = useState(6);

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No opportunities found — which usually means there is not enough data
        yet rather than that the site is perfect. Check the readiness panel.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.slice(0, limit).map((o) => (
          <article
            key={o.id}
            className="cs-sheen group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {KIND_LABEL[o.kind] ?? o.kind}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                  EFFORT_TONE[o.effort],
                )}
              >
                {o.effort} effort
              </span>
            </div>

            <h3 className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug">
              {o.title}
            </h3>

            <p className="mt-1.5 line-clamp-3 flex-1 text-[13px] leading-relaxed text-muted-foreground">
              {o.detail}
            </p>

            <div className="mt-3 space-y-2">
              <Meter value={o.impactScore} label="Impact" caption={`${String(o.impactScore)}/100`} size="sm" />
              <Meter
                value={o.confidence * 100}
                label="Confidence"
                caption={`${String(Math.round(o.confidence * 100))}%`}
                size="sm"
              />
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 p-2.5">
              <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <p className="text-[12px] leading-snug">{o.action}</p>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <FigureValue figure={o.impactClicks} showChip={o.impactClicks.value === null} />
              {o.timeToImpactDays !== null && <span>~{o.timeToImpactDays} days</span>}
            </div>
          </article>
        ))}
      </div>

      {limit < items.length && (
        <button
          type="button"
          onClick={() => {
            setLimit((v) => v + 9);
          }}
          className="w-full rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          Show {Math.min(9, items.length - limit)} more of {items.length}
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Priority matrix
 * ---------------------------------------------------------------------- */

export function PriorityMatrix({ opportunities }: { opportunities: Opportunity[] }) {
  const counts = { "quick-win": 0, strategic: 0, maintain: 0, deprioritize: 0 };
  for (const o of opportunities) counts[quadrantFor(o.impactScore, o.effort)] += 1;

  return (
    <div className="grid gap-4 rounded-xl border border-border bg-card p-4 lg:grid-cols-[1fr_auto] sm:p-5">
      <ImpactEffortMatrix
        points={opportunities.map((o) => ({
          id: o.id,
          title: o.title,
          impact: o.impactScore,
          effort: o.effort,
          kind: o.kind,
        }))}
      />

      <dl className="grid grid-cols-2 gap-3 self-center lg:w-44 lg:grid-cols-1">
        {(Object.keys(counts) as (keyof typeof counts)[]).map((q) => (
          <div key={q} className="min-w-0 rounded-lg border border-border px-3 py-2">
            <dt className="truncate text-[11px] text-muted-foreground">{QUADRANT_LABEL[q]}</dt>
            <dd className="text-lg font-semibold tabular-nums">{counts[q]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Keyword forecast
 * ---------------------------------------------------------------------- */

const REACH_TONE: Record<ReachabilityBand, string> = {
  likely: "bg-success/12 text-success",
  realistic: "bg-primary/12 text-primary",
  stretch: "bg-warning/15 text-warning",
  "too-ambitious": "bg-destructive/12 text-destructive",
};

/** Today's position and the modelled one, as a movement rather than two numbers. */
function PositionDelta({ from, to }: { from: number | null; to: number | null }) {
  if (to === null) return <span className="text-muted-foreground">—</span>;

  const moved = from !== null && Math.abs(from - to) >= 0.1;

  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span className="text-muted-foreground">{from === null ? "—" : from.toFixed(1)}</span>
      <ArrowRight className={cn("size-3", moved ? "text-primary" : "text-muted-foreground/50")} aria-hidden />
      <span className="font-semibold">{to.toFixed(1)}</span>
    </span>
  );
}

export function KeywordTable({ keywords }: { keywords: KeywordProjection[] }) {
  const [openRow, setOpenRow] = useState<string | null>(null);

  if (keywords.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No keyword-level forecast yet. This needs Search Console queries, tracked
        keywords, or cached search results where this site appears.
      </p>
    );
  }

  const longest = Math.max(...keywords.map((k) => k.timeToRank?.slowerDays ?? 0), 1);

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Keyword</th>
            <th className="px-4 py-2.5 text-left font-medium">Position</th>
            <th className="px-4 py-2.5 text-left font-medium">Reachability</th>
            <th className="px-4 py-2.5 text-left font-medium">Time to rank</th>
            <th className="px-4 py-2.5 text-right font-medium">Extra clicks</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((k) => {
            const open = openRow === k.keyword;
            return (
              <>
                <tr
                  key={k.keyword}
                  onClick={() => {
                    setOpenRow(open ? null : k.keyword);
                  }}
                  className={cn(
                    "cursor-pointer border-b border-border transition-colors hover:bg-accent/40",
                    open && "bg-accent/30",
                  )}
                >
                  <td className="max-w-[260px] px-4 py-3">
                    <span className="block truncate font-medium" title={k.keyword}>
                      {k.keyword}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      target position {k.targetPosition}
                      {k.serpFeatures.length > 0 && ` · ${String(k.serpFeatures.length)} SERP features`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <PositionDelta from={k.currentPosition.value} to={k.expectedPosition.value} />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                        REACH_TONE[k.reachability.band],
                      )}
                    >
                      {REACHABILITY_LABEL[k.reachability.band]}
                    </span>
                  </td>
                  <td className="w-40 px-4 py-3">
                    {k.timeToRank === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        <RangeBar
                          fastest={k.timeToRank.fastestDays}
                          expected={k.timeToRank.expectedDays}
                          slower={k.timeToRank.slowerDays}
                          max={longest}
                        />
                        <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                          {k.timeToRank.fastestDays}–{k.timeToRank.slowerDays} days
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <FigureValue figure={k.incrementalClicks} showChip={false} className="font-medium" />
                  </td>
                </tr>

                {open && (
                  <tr key={`${k.keyword}-detail`} className="border-b border-border bg-muted/20">
                    <td colSpan={5} className="px-4 py-4">
                      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
                        <div>
                          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                            Gaps to close
                          </p>
                          <GapBars
                            gaps={Object.values(k.reachability.gaps).map((g) => ({
                              label: g.label,
                              size: g.size,
                              detail: g.detail,
                              known: g.provenance !== "unavailable",
                            }))}
                          />
                        </div>

                        <div className="space-y-3 text-[13px]">
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              Why {REACHABILITY_LABEL[k.reachability.band].toLowerCase()}
                            </p>
                            <ul className="mt-1 space-y-1 text-muted-foreground">
                              {k.reachability.reasons.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>

                          <div className="flex flex-wrap gap-x-6 gap-y-2">
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Demand
                              </p>
                              <FigureValue figure={k.demand} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Forecast CTR
                              </p>
                              <FigureValue figure={k.forecastCtr} unit="percent" showChip={false} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Confidence
                              </p>
                              <span className="tabular-nums">{Math.round(k.confidence * 100)}%</span>
                            </div>
                          </div>

                          <p className="text-[12px] leading-snug text-muted-foreground">
                            {k.demand.note}
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Action plan
 * ---------------------------------------------------------------------- */

/**
 * One card per piece of work, except where the work is the same piece twenty
 * times over.
 *
 * Twenty separate "fix what is blocking /this-page from being indexed" cards,
 * each repeating the same sentence, is a wall of duplicated prose — and worse
 * advice than the truth, which is that clearing indexability across twenty
 * pages is one job somebody sits down and does. Three or more of a kind in the
 * same month collapse into a single card that lists them.
 */
type PlanEntry =
  | { type: "single"; action: PlanAction }
  | { type: "group"; kind: string; actions: PlanAction[] };

const GROUP_AT = 3;

/**
 * What a grouped card says instead of the first item's own sentence.
 *
 * Reusing `actions[0].why` left the group reading "The last audit found **this
 * page** non-indexable" above a list of four pages — singular prose captioning
 * a plural card.
 */
const GROUP_WHY: Record<string, string> = {
  technical:
    "The audit found these pages non-indexable. Nothing else on this list matters for them until that is fixed.",
  "internal-links":
    "These pages earn impressions with almost nothing linking to them. Internal links are the cheapest ranking signal you control outright.",
  "content-gap":
    "Nothing on this site ranks for these queries, though you publish closely related pages already.",
  "serp-feature":
    "You already rank on page one for these. Answering the question in the format the feature uses is how pages win those slots.",
  "striking-distance":
    "These queries already earn impressions just off the positions that get clicked.",
  "low-ctr":
    "These rank well and earn far fewer clicks than the position should. That is a title and snippet problem, not a ranking one.",
  cannibalization:
    "Each of these is a set of pages competing for the same intent, splitting the signals between them.",
};

const GROUP_TITLE: Record<string, (n: number) => string> = {
  technical: (n) => `Clear the indexing blocks on ${String(n)} pages`,
  "internal-links": (n) => `Add internal links to ${String(n)} under-linked pages`,
  "content-gap": (n) => `Write ${String(n)} pages for queries you do not cover`,
  "serp-feature": (n) => `Answer ${String(n)} questions in the format their SERP feature uses`,
  "striking-distance": (n) => `Push ${String(n)} near-miss queries onto page one`,
  "low-ctr": (n) => `Rewrite titles and descriptions for ${String(n)} queries`,
  cannibalization: (n) => `Consolidate ${String(n)} sets of overlapping pages`,
};

function groupActions(actions: PlanAction[]): PlanEntry[] {
  const byKind = new Map<string, PlanAction[]>();
  for (const a of actions) {
    const list = byKind.get(a.kind) ?? [];
    list.push(a);
    byKind.set(a.kind, list);
  }

  const out: PlanEntry[] = [];
  const grouped = new Set<string>();

  for (const [kind, list] of byKind) {
    if (list.length < GROUP_AT) continue;
    grouped.add(kind);
    out.push({ type: "group", kind, actions: list });
  }

  for (const a of actions) {
    if (grouped.has(a.kind)) continue;
    out.push({ type: "single", action: a });
  }

  return out;
}

/** The page or query a repeated action is about, without the boilerplate. */
function subjectOf(action: PlanAction): string {
  if (action.page !== null) {
    try {
      return new URL(action.page).pathname;
    } catch {
      return action.page;
    }
  }
  return action.keyword ?? action.title;
}

export function ActionPlan({
  plan,
  horizonMonths,
  note,
}: {
  plan: PlanAction[];
  horizonMonths: number;
  note: string;
}) {
  const scheduled = plan.filter((a) => a.scheduledMonth !== null);
  const unscheduled = plan.filter((a) => a.scheduledMonth === null);
  const months = Array.from({ length: horizonMonths }, (_, m) =>
    groupActions(scheduled.filter((a) => a.scheduledMonth === m)),
  );

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">{note}</p>

      <ol className="relative space-y-4 border-l border-border pl-6">
        {months.map((entries, m) =>
          entries.length === 0 ? null : (
            <li key={m} className="relative">
              <span className="absolute -left-[27px] top-1 flex size-4 items-center justify-center rounded-full border border-border bg-card">
                <span className="size-1.5 rounded-full bg-primary" />
              </span>

              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary">
                Month {m + 1}
              </p>

              <ul className="mt-2 space-y-2">
                {entries.map((entry) =>
                  entry.type === "single" ? (
                    <PlanCard key={entry.action.id} action={entry.action} />
                  ) : (
                    <PlanGroupCard key={entry.kind} kind={entry.kind} actions={entry.actions} />
                  ),
                )}
              </ul>
            </li>
          ),
        )}
      </ol>

      {unscheduled.length > 0 && (
        <details className="rounded-xl border border-dashed border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {unscheduled.length} more that do not fit in {horizonMonths} months
          </summary>
          <p className="mt-2 text-[13px] text-muted-foreground">
            These contribute nothing to the forecast above. Raise your monthly
            capacity or lengthen the horizon to bring them in.
          </p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {unscheduled.slice(0, 15).map((a) => (
              <li key={a.id} className="truncate text-muted-foreground" title={a.title}>
                {a.title}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Methodology
 * ---------------------------------------------------------------------- */

export function Methodology({ forecast }: { forecast: Forecast }) {
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 sm:p-5">
        <span>
          <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
            Transparency
          </span>
          <span className="mt-0.5 block text-base font-semibold">How this forecast works</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="grid gap-6 border-t border-border p-4 sm:p-5 lg:grid-cols-2">
        <Block title="Data">
          <ul className="space-y-1.5">
            {forecast.dataSources.map((d) => (
              <li key={d.label} className="flex flex-wrap items-center gap-2 text-[13px]">
                <ProvenanceChip provenance={d.provenance} />
                <span className="font-medium">{d.label}</span>
                <span className="text-muted-foreground">{d.source}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Cutoff {forecast.dataCutoff ?? "none — nothing connected"} · Model{" "}
            {forecast.modelVersion} · Assumptions {forecast.assumptionVersion}
          </p>
        </Block>

        <Block title="Click-through model">
          <p className="text-[13px] text-muted-foreground">{forecast.ctrModel.note}</p>
          <div className="mt-3 flex items-end gap-1" aria-hidden>
            {forecast.ctrModel.curve.map((c, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-primary/70"
                  style={{ height: `${String(Math.max(3, (c / Math.max(...forecast.ctrModel.curve)) * 56))}px` }}
                />
                <span className="text-[9px] text-muted-foreground">{i + 1}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Modelled click-through by position, 1 to 10.
          </p>
        </Block>

        <Block title="Assumptions">
          <ul className="space-y-2">
            {forecast.assumptionNotes.map((a) => (
              <li key={a.label} className="text-[13px]">
                <span className="font-medium">{a.label}: </span>
                <span>{a.value}</span>
                {a.userSet && (
                  <span className="ml-1.5 rounded bg-primary/12 px-1.5 py-0.5 text-[10px] uppercase text-primary">
                    you set this
                  </span>
                )}
                <span className="block text-muted-foreground">{a.why}</span>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Uncertainty and accuracy">
          {forecast.uncertainty.simulated ? (
            <>
              <p className="text-[13px] text-muted-foreground">
                The range comes from {forecast.uncertainty.runs.toLocaleString()}{" "}
                simulations over the inputs that are genuinely uncertain. P10 and
                P90 are percentiles of the model&apos;s own outputs — not
                calibrated probabilities, and they will not be until the model
                has been checked against enough real outcomes.
              </p>
              <div className="mt-3 space-y-2">
                {forecast.uncertainty.drivers.map((d) => (
                  <Meter
                    key={d.label}
                    value={d.share * 100}
                    label={d.label}
                    caption={`${String(Math.round(d.share * 100))}% of the spread`}
                    size="sm"
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No range is shown because there is no traffic forecast to put a
              range around.
            </p>
          )}

          <p className="mt-3 text-[13px] text-muted-foreground">
            {forecast.confidence === null
              ? "This model has not been evaluated against real outcomes for this project, so no accuracy figure is shown. Backtesting needs about six months of Search Console history; the model is then refitted on data from before each cutoff and scored against what actually happened."
              : `Backtested over ${String(forecast.confidence.windows)} rolling windows. Mean absolute error ${forecast.confidence.mae.toLocaleString()} clicks per month, direction correct ${String(Math.round(forecast.confidence.directionAccuracy * 100))}% of the time.`}
          </p>
        </Block>

        <p className="rounded-lg bg-muted/60 p-3 text-[12px] leading-relaxed text-muted-foreground lg:col-span-2">
          Everything above models what could happen, not what will. The numbers
          move when the assumptions move, which is what they are for — nothing
          here is a guarantee, and no part of the forecast is produced by an AI
          model.
        </p>
      </div>
    </details>
  );
}

function PlanCard({ action }: { action: PlanAction }) {
  return (
    <li className="rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium leading-snug">{action.title}</p>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
            EFFORT_TONE[action.effort],
          )}
        >
          {action.effort}
        </span>
      </div>

      <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
        {action.why}
      </p>

      <PlanMeta action={action} />
    </li>
  );
}

function PlanGroupCard({ kind, actions }: { kind: string; actions: PlanAction[] }) {
  const [open, setOpen] = useState(false);
  const first = actions[0]!;
  const shown = open ? actions : actions.slice(0, 6);

  return (
    <li className="rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium leading-snug">
          {GROUP_TITLE[kind]?.(actions.length) ?? `${String(actions.length)} similar tasks`}
        </p>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
            EFFORT_TONE[first.effort],
          )}
        >
          {first.effort}
        </span>
      </div>

      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        {GROUP_WHY[kind] ?? first.why}
      </p>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {shown.map((a) => (
          <li
            key={a.id}
            className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
            title={a.title}
          >
            {subjectOf(a)}
          </li>
        ))}
        {!open && actions.length > shown.length && (
          <li>
            <button
              type="button"
              onClick={() => {
                setOpen(true);
              }}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:underline"
            >
              +{actions.length - shown.length} more
            </button>
          </li>
        )}
      </ul>

      <PlanMeta action={first} count={actions.length} />
    </li>
  );
}

function PlanMeta({ action, count }: { action: PlanAction; count?: number }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span>{QUADRANT_LABEL[action.quadrant]}</span>
      <span className="tabular-nums">Confidence {Math.round(action.confidence * 100)}%</span>
      {action.timeToImpactDays !== null && (
        <span className="tabular-nums">~{action.timeToImpactDays} days to impact</span>
      )}
      {count !== undefined && <span className="tabular-nums">{count} pages</span>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}
