"use client";

import { Sparkline } from "@/components/foresight/charts";
import { cn } from "@/lib/utils";
import {
  FORESIGHT_PROVENANCE_LABEL,
  FORESIGHT_PROVENANCE_NOTE,
  FORESIGHT_PROVENANCE_TONE,
  type Figure,
  type ForesightProvenance,
} from "@/lib/foresight/types";

/**
 * A number and what kind of claim it is, rendered together.
 *
 * The whole feature turns on this. A forecast that renders "12,400 clicks" in
 * the same weight and colour as "11,850 measured last month" has told the
 * reader they are the same kind of fact, and every careful thing the engine
 * does upstream is undone at the last inch.
 *
 * The chip is small and quiet on purpose. An earlier pass put one beside every
 * figure on the page and produced fifty-one identical badges — at that density
 * a label stops being read and becomes texture. It now rides the headline
 * figures and anything unavailable, and a single legend explains the scheme
 * once.
 */
export function ProvenanceChip({
  provenance,
  className,
}: {
  provenance: ForesightProvenance;
  className?: string;
}) {
  return (
    <span
      title={FORESIGHT_PROVENANCE_NOTE[provenance]}
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        FORESIGHT_PROVENANCE_TONE[provenance],
        className,
      )}
    >
      {FORESIGHT_PROVENANCE_LABEL[provenance]}
    </span>
  );
}

export type FigureUnit = "count" | "percent" | "currency" | "position";

function format(value: number, unit: FigureUnit): string {
  if (unit === "percent") return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  if (unit === "currency") {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  if (unit === "position") return value.toFixed(1);
  return Math.round(value).toLocaleString();
}

export function FigureValue({
  figure,
  unit = "count",
  className,
  showChip = true,
}: {
  figure: Figure;
  unit?: FigureUnit;
  className?: string;
  showChip?: boolean;
}) {
  if (figure.value === null) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1.5">
        <span className={cn("text-muted-foreground", className)} title={figure.note}>
          Not available
        </span>
        {showChip && <ProvenanceChip provenance="unavailable" />}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <span className={cn("tabular-nums", className)} title={figure.note}>
        {format(figure.value, unit)}
      </span>
      {showChip && <ProvenanceChip provenance={figure.provenance} />}
    </span>
  );
}

/**
 * One headline number, its change, and the shape behind it.
 *
 * A stat tile rather than a one-bar chart: the number *is* the chart, and the
 * sparkline supplies the direction that a bare figure cannot. Proportional
 * figures on the value — equal-width digits make a large standalone number look
 * loose, and there is nothing here for it to align with.
 */
export function StatTile({
  label,
  value,
  unit = "count",
  change,
  spark,
  hint,
  emphasis = false,
}: {
  label: string;
  value: Figure;
  unit?: FigureUnit;
  change?: Figure;
  spark?: number[];
  hint?: string;
  emphasis?: boolean;
}) {
  const delta = change?.value ?? null;

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm",
        emphasis ? "border-primary/30 ring-1 ring-primary/10" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <ProvenanceChip provenance={value.provenance} />
      </div>

      <p
        className={cn(
          "mt-2 font-semibold leading-none",
          value.value === null ? "text-xl text-muted-foreground" : "text-[2rem]",
        )}
        title={value.note}
      >
        {value.value === null ? "Not available" : format(value.value, unit)}
      </p>

      {delta !== null && (
        <p
          className={cn(
            "mt-1.5 text-xs font-medium tabular-nums",
            delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {format(delta, "percent")} against doing nothing
        </p>
      )}

      {spark !== undefined && spark.length > 1 && (
        <div className="-mx-1 mt-3">
          <Sparkline values={spark} />
        </div>
      )}

      {hint !== undefined && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Explains the four kinds of number once, so the chips can stay small. */
export function ProvenanceLegend({ className }: { className?: string }) {
  const shown: ForesightProvenance[] = ["real", "derived", "modeled", "unavailable"];

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {shown.map((p) => (
        <span key={p} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ProvenanceChip provenance={p} />
          {FORESIGHT_PROVENANCE_NOTE[p]}
        </span>
      ))}
    </div>
  );
}
