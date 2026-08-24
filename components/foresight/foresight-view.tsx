"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Save, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ForecastChart } from "@/components/foresight/forecast-chart";
import {
  ProvenanceLegend,
  StatTile,
} from "@/components/foresight/figure-value";
import {
  ActionPlan,
  KeywordTable,
  Methodology,
  OpportunityCards,
  PriorityMatrix,
  ReadinessPanel,
  SectionHead,
} from "@/components/foresight/panels";
import type { SavedForecastSummary } from "@/lib/foresight/store";
import { cn } from "@/lib/utils";
import {
  HORIZONS,
  SCENARIOS,
  SCENARIO_LABEL,
  type Forecast,
  type Horizon,
  type Scenario,
} from "@/lib/foresight/types";

type Controls = {
  horizon: Horizon;
  scenario: Scenario;
  targetPosition: number;
  conversionRate: string;
  revenuePerConversion: string;
  articlesPerMonth: number;
  optimisationsPerMonth: number;
  internalLinksPerMonth: number;
};

function toQuery(projectId: string, c: Controls): string {
  const params = new URLSearchParams({
    projectId,
    horizon: String(c.horizon),
    scenario: c.scenario,
    targetPosition: String(c.targetPosition),
    articlesPerMonth: String(c.articlesPerMonth),
    optimisationsPerMonth: String(c.optimisationsPerMonth),
    internalLinksPerMonth: String(c.internalLinksPerMonth),
  });

  // Conversion inputs are omitted entirely when blank rather than sent as zero.
  // Zero is an assumption; blank is the absence of one, and the readiness panel
  // reports them differently.
  const rate = Number(c.conversionRate);
  if (c.conversionRate.trim() !== "" && Number.isFinite(rate) && rate > 0) {
    params.set("conversionRate", String(rate / 100));
  }
  const value = Number(c.revenuePerConversion);
  if (c.revenuePerConversion.trim() !== "" && Number.isFinite(value) && value > 0) {
    params.set("revenuePerConversion", String(value));
  }

  return params.toString();
}

export function ForesightView({
  projectId,
  projectName,
  initialForecast,
  initialSaved,
}: {
  projectId: string;
  projectName: string;
  initialForecast: Forecast;
  initialSaved: SavedForecastSummary[];
}) {
  const [forecast, setForecast] = useState(initialForecast);
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tuningOpen, setTuningOpen] = useState(false);

  const [controls, setControls] = useState<Controls>({
    horizon: initialForecast.assumptions.horizonMonths,
    scenario: initialForecast.assumptions.scenario,
    targetPosition: initialForecast.assumptions.defaultTargetPosition,
    conversionRate: "",
    revenuePerConversion: "",
    articlesPerMonth: initialForecast.assumptions.contentVelocity.articlesPerMonth,
    optimisationsPerMonth: initialForecast.assumptions.contentVelocity.optimisationsPerMonth,
    internalLinksPerMonth: initialForecast.assumptions.contentVelocity.internalLinksPerMonth,
  });

  const first = useRef(true);

  const rebuild = useCallback(
    async (next: Controls) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/foresight?${toQuery(projectId, next)}`);
        const data = (await res.json()) as {
          forecast?: Forecast;
          saved?: SavedForecastSummary[];
          error?: string;
        };
        if (!res.ok || data.forecast === undefined) {
          toast.error(data.error ?? "Could not rebuild the forecast.");
          return;
        }
        setForecast(data.forecast);
        if (data.saved) setSaved(data.saved);
      } catch {
        toast.error("Could not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void rebuild(controls);
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [controls, rebuild]);

  const set = <K extends keyof Controls>(key: K, value: Controls[K]) => {
    setControls((c) => ({ ...c, [key]: value }));
  };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/foresight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: `${SCENARIO_LABEL[controls.scenario]} · ${String(controls.horizon)} months`,
          horizon: controls.horizon,
          scenario: controls.scenario,
          targetPosition: controls.targetPosition,
          articlesPerMonth: controls.articlesPerMonth,
          optimisationsPerMonth: controls.optimisationsPerMonth,
          internalLinksPerMonth: controls.internalLinksPerMonth,
        }),
      });
      const data = (await res.json()) as { saved?: SavedForecastSummary[]; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not save the forecast.");
        return;
      }
      if (data.saved) setSaved(data.saved);
      toast.success("Forecast saved. Compare it against actuals once the months elapse.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function compare(id: string) {
    const res = await fetch(`/api/foresight/${id}`, { method: "POST" });
    const data = (await res.json()) as { note?: string };
    toast.message(data.note ?? "Compared.");
    const refresh = await fetch(`/api/foresight?${toQuery(projectId, controls)}`);
    const payload = (await refresh.json()) as { saved?: SavedForecastSummary[] };
    if (payload.saved) setSaved(payload.saved);
  }

  const history = useMemo(
    () => forecast.baseline.history.map((h) => ({ month: h.month, clicks: h.clicks })),
    [forecast.baseline.history],
  );

  const chartMonths = useMemo(
    () =>
      forecast.months.map((m, i) => ({
        ...m,
        p10: forecast.uncertainty.band.p10[i] ?? null,
        p90: forecast.uncertainty.band.p90[i] ?? null,
      })),
    [forecast.months, forecast.uncertainty.band],
  );

  const canForecast = forecast.readiness.capabilities.trafficForecast;

  const planNote = useMemo(() => {
    const scheduled = forecast.plan.filter((a) => a.scheduledMonth !== null).length;
    const total = forecast.plan.length;
    return scheduled === total
      ? `All ${String(total)} opportunities fit inside ${String(controls.horizon)} months at your stated capacity.`
      : `${String(scheduled)} of ${String(total)} fit inside ${String(controls.horizon)} months at ${String(controls.articlesPerMonth)} articles and ${String(controls.optimisationsPerMonth)} optimisations a month. The rest contribute nothing to the forecast.`;
  }, [forecast.plan, controls]);

  const quickWins = forecast.plan.filter(
    (a) => a.quadrant === "quick-win" && a.scheduledMonth !== null,
  ).length;
  const blocked = forecast.opportunities.filter((o) => o.kind === "technical").length;

  /** The one sentence the page exists to deliver. */
  const headline = canForecast
    ? `${(forecast.totals.incrementalClicks.value ?? 0).toLocaleString()} extra clicks over ${String(controls.horizon)} months, above doing nothing.`
    : `${String(forecast.opportunities.length)} opportunities found across your cached search data and site audit.`;

  return (
    <div className="space-y-8 pb-4">
      {/* ---- Hero ------------------------------------------------------ */}
      <header className="cs-in relative overflow-hidden rounded-2xl border border-border bg-card">
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-[0.07]"
          style={{ background: "radial-gradient(circle, var(--primary), transparent 70%)" }}
          aria-hidden
        />

        <div className="relative p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-2xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
                SEO Foresight Engine
              </p>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">
                Foresight
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                {headline}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Modelled for {projectName} from data already collected — no new
                API calls were made to build this.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
              <Button size="sm" variant="outline" onClick={() => void rebuild(controls)}>
                <RefreshCw className="size-3.5" aria-hidden />
                Rebuild
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-3.5" aria-hidden />
                )}
                Save forecast
              </Button>
            </div>
          </div>

          {/* Segmented controls, not a form. The two that change the whole
              picture sit here; everything else is behind Tune. */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Segmented
              options={HORIZONS.map((h) => ({ value: String(h), label: `${String(h)}m` }))}
              value={String(controls.horizon)}
              onChange={(v) => {
                set("horizon", Number(v) as Horizon);
              }}
              label="Forecast horizon"
            />
            <Segmented
              options={SCENARIOS.map((s) => ({ value: s, label: SCENARIO_LABEL[s] }))}
              value={controls.scenario}
              onChange={(v) => {
                set("scenario", v as Scenario);
              }}
              label="Scenario"
            />
            <button
              type="button"
              onClick={() => {
                setTuningOpen((v) => !v);
              }}
              aria-expanded={tuningOpen}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                tuningOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-input text-muted-foreground hover:text-foreground",
              )}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
              Tune
            </button>
          </div>

          {tuningOpen && (
            <div className="mt-4 grid gap-4 rounded-xl border border-border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Target position">
                <NumberInput
                  value={controls.targetPosition}
                  min={1}
                  max={30}
                  onChange={(v) => {
                    set("targetPosition", v);
                  }}
                />
              </Field>
              <Field label="Conversion rate %" hint="Blank means leads and revenue are not modelled.">
                <TextInput
                  value={controls.conversionRate}
                  placeholder="not set"
                  onChange={(v) => {
                    set("conversionRate", v);
                  }}
                />
              </Field>
              <Field label="Value per conversion">
                <TextInput
                  value={controls.revenuePerConversion}
                  placeholder="not set"
                  onChange={(v) => {
                    set("revenuePerConversion", v);
                  }}
                />
              </Field>
              <Field label="Articles / month">
                <NumberInput
                  value={controls.articlesPerMonth}
                  min={0}
                  max={60}
                  onChange={(v) => {
                    set("articlesPerMonth", v);
                  }}
                />
              </Field>
              <Field label="Optimisations / month">
                <NumberInput
                  value={controls.optimisationsPerMonth}
                  min={0}
                  max={120}
                  onChange={(v) => {
                    set("optimisationsPerMonth", v);
                  }}
                />
              </Field>
              <Field label="Internal links / month">
                <NumberInput
                  value={controls.internalLinksPerMonth}
                  min={0}
                  max={500}
                  onChange={(v) => {
                    set("internalLinksPerMonth", v);
                  }}
                />
              </Field>
            </div>
          )}
        </div>
      </header>

      <ReadinessPanel readiness={forecast.readiness} />

      {/* ---- Headline figures ------------------------------------------ */}
      {canForecast ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Incremental clicks"
            value={forecast.totals.incrementalClicks}
            change={forecast.totals.changePercent}
            emphasis
            spark={forecast.months.map((m) => m.expected - m.baseline)}
            hint="What the plan adds over doing nothing."
          />
          <StatTile
            label={`Forecast clicks · ${String(controls.horizon)}m`}
            value={forecast.totals.forecastHorizonClicks}
            spark={forecast.months.map((m) => m.expected)}
          />
          <StatTile
            label="Current clicks / month"
            value={forecast.totals.currentMonthlyClicks}
            spark={forecast.baseline.history.slice(-12).map((h) => h.clicks)}
          />
          <StatTile
            label="Estimated revenue"
            unit="currency"
            value={
              forecast.business?.revenue ?? {
                value: null,
                provenance: "unavailable",
                note: "Enter a conversion rate and a value per conversion under Tune.",
              }
            }
            hint={
              forecast.business === null
                ? "Add a conversion rate under Tune to model this."
                : undefined
            }
          />
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CountTile
            label="Opportunities found"
            value={forecast.opportunities.length}
            hint="From cached search results and your latest site audit."
            emphasis
          />
          <CountTile
            label="Quick wins scheduled"
            value={quickWins}
            hint={`Inside ${String(controls.horizon)} months at your stated capacity.`}
          />
          <CountTile
            label="Pages blocked from ranking"
            value={blocked}
            hint="Found by the site audit. Nothing else helps these until they are fixed."
            tone={blocked > 0 ? "text-destructive" : undefined}
          />
          <div className="flex min-w-0 flex-col rounded-xl border border-dashed border-border bg-card p-4">
            <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
              Traffic &amp; revenue forecast
            </p>
            <p className="mt-2 text-xl font-semibold text-muted-foreground">Locked</p>
            <p className="mt-1.5 flex-1 text-[11px] leading-snug text-muted-foreground">
              Projecting clicks needs measured clicks to project from. Nothing is
              estimated in the meantime.
            </p>
            <Link
              href="/integrations"
              className="mt-2 inline-block text-[12px] font-medium text-primary hover:underline"
            >
              Connect Search Console →
            </Link>
          </div>
        </section>
      )}

      {/* ---- Chart ----------------------------------------------------- */}
      {canForecast && (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <SectionHead
            eyebrow="Baseline against plan"
            title="History and forecast"
            note={
              forecast.baseline.shape === "unknown"
                ? undefined
                : `Trend is ${forecast.baseline.shape}${forecast.baseline.slopePerMonth === 0 ? "" : ` at ${forecast.baseline.slopePerMonth > 0 ? "+" : ""}${String(forecast.baseline.slopePerMonth)} clicks a month`}. The shaded wedge is the incremental gain.`
            }
          />
          <div className="mt-4">
            <ForecastChart history={history} months={chartMonths} />
          </div>

          {forecast.baseline.seasonality !== null && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Seasonality detected over {forecast.baseline.seasonality.years} year
              {forecast.baseline.seasonality.years === 1 ? "" : "s"}: peaks in month{" "}
              {forecast.baseline.seasonality.peakMonth + 1}, lowest in month{" "}
              {forecast.baseline.seasonality.troughMonth + 1}.
            </p>
          )}
        </section>
      )}

      {/* ---- Opportunities --------------------------------------------- */}
      <section className="space-y-4">
        <SectionHead
          eyebrow="Where the upside is"
          title="Biggest opportunities"
          note="Found by scanning everything already collected for this project."
        />
        <OpportunityCards items={forecast.opportunities} />
      </section>

      {/* ---- Matrix ---------------------------------------------------- */}
      {forecast.opportunities.length > 0 && (
        <section className="space-y-4">
          <SectionHead
            eyebrow="What to do first"
            title="Impact against effort"
            note="Every opportunity placed by what it returns and what it costs. Larger dots carry more impact; hover one for the detail."
          />
          <PriorityMatrix opportunities={forecast.opportunities} />
        </section>
      )}

      {/* ---- Keywords -------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHead
          eyebrow="Keyword by keyword"
          title="Ranking forecast"
          note="Click a row for the gaps behind each judgement."
        />
        <KeywordTable keywords={forecast.keywords} />
      </section>

      {/* ---- Plan ------------------------------------------------------ */}
      <section className="space-y-4">
        <SectionHead eyebrow="The roadmap" title="SEO action plan" />
        <ActionPlan plan={forecast.plan} horizonMonths={controls.horizon} note={planNote} />
      </section>

      {/* ---- Saved ----------------------------------------------------- */}
      {saved.length > 0 && (
        <section className="space-y-4">
          <SectionHead
            eyebrow="Track the record"
            title="Saved forecasts"
            note="Each stores its assumptions and model version, so it stays reproducible and can be scored against what actually happened."
          />

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Forecast</th>
                  <th className="px-4 py-2.5 text-left font-medium">Saved</th>
                  <th className="px-4 py-2.5 text-right font-medium">Incremental</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actual</th>
                  <th className="px-4 py-2.5 text-right font-medium">Variance</th>
                  <th className="px-4 py-2.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {saved.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{s.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {s.modelVersion} · cutoff {s.dataCutoff ?? "none"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.incrementalClicks.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.comparison === null ? "—" : s.comparison.actual.toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums",
                        s.comparison === null
                          ? ""
                          : s.comparison.variancePercent >= 0
                            ? "text-success"
                            : "text-destructive",
                      )}
                    >
                      {s.comparison === null
                        ? "—"
                        : `${s.comparison.variancePercent > 0 ? "+" : ""}${s.comparison.variancePercent.toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void compare(s.id)}
                        className="text-[12px] font-medium text-primary hover:underline"
                      >
                        Compare
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Methodology forecast={forecast} />

      <ProvenanceLegend className="border-t border-border pt-4" />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Controls
 * ---------------------------------------------------------------------- */

function Segmented({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-input bg-background p-0.5"
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => {
            onChange(o.value);
          }}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CountTile({
  label,
  value,
  hint,
  tone,
  emphasis = false,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm",
        emphasis ? "border-primary/30 ring-1 ring-primary/10" : "border-border",
      )}
    >
      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-2 text-[2rem] font-semibold leading-none", tone)}>{value}</p>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint !== undefined && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

const INPUT =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)));
      }}
      className={INPUT}
    />
  );
}

function TextInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      step="0.1"
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className={INPUT}
    />
  );
}
