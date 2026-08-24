"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The small marks Foresight draws, built once and shared.
 *
 * Every one of these replaced a sentence. The readiness score was a number and
 * a paragraph; the four reachability gaps were four integers; impact against
 * effort was a two-by-two grid of bullet lists. Those are all quantities, and a
 * quantity written out in prose makes the reader do the comparing that the
 * picture should have done for them.
 *
 * The specs are fixed rather than per-chart: 2px lines, ≥8px markers carrying a
 * 2px surface ring, 4px rounded data-ends squared at the baseline, area washes
 * at about 10%, and hairline solid gridlines one step off the surface. Dashes
 * are reserved for marks that genuinely mean "projected" or "threshold" — a
 * dashed gridline reads as a claim the grid is not making.
 *
 * There is deliberately no categorical palette here. Nothing in Foresight
 * encodes identity by colour: every chart is one accent hue against greys, so
 * the one adjacency that fails colour-blind separation on this palette —
 * success green beside warning amber — never appears as two marks. Those two
 * survive only on the readiness checks, where each carries an icon and a text
 * label as well.
 */

/* -------------------------------------------------------------------------
 * Meter — a single ratio against a limit
 * ---------------------------------------------------------------------- */

/**
 * One value on a fixed track.
 *
 * A meter rather than a radial dial: a ring showing one percentage is a
 * two-slice pie, and the reader has to estimate an angle to get a number the
 * label is already telling them. A track is read at a glance and stacks
 * cleanly beside other tracks.
 */
export function Meter({
  value,
  max = 100,
  label,
  caption,
  size = "md",
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  caption?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value / max));

  return (
    <div className={cn("min-w-0", className)}>
      {(label !== undefined || caption !== undefined) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label !== undefined && (
            <span className="truncate text-[11px] text-muted-foreground">{label}</span>
          )}
          {caption !== undefined && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {caption}
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          "w-full overflow-hidden rounded-full bg-muted",
          size === "sm" ? "h-1.5" : "h-2.5",
        )}
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${String(pct * 100)}%` }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Sparkline — the trend behind a stat tile
 * ---------------------------------------------------------------------- */

/**
 * A single series, no axes, no legend.
 *
 * It exists to answer "and which way has this been going" without spending a
 * second card on it. One series means no legend box: the tile's own label
 * already says what is plotted.
 */
export function Sparkline({
  values,
  className,
  height = 34,
}: {
  values: number[];
  className?: string;
  height?: number;
}) {
  const id = useId();
  if (values.length < 2) return null;

  const w = 120;
  const h = height;
  const pad = 3;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  const x = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(values.length - 1).toFixed(1)} ${String(h - pad)} L ${String(pad)} ${String(h - pad)} Z`;

  const last = values[values.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${String(w)} ${String(h)}`}
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={x(values.length - 1)}
        cy={y(last)}
        r="3"
        fill="var(--primary)"
        stroke="var(--card)"
        strokeWidth="2"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------
 * Gap bars — four magnitudes on one scale
 * ---------------------------------------------------------------------- */

export type GapDatum = {
  label: string;
  /** 0–100. Higher is a wider gap, so shorter is better here. */
  size: number;
  detail: string;
  known: boolean;
};

/**
 * The four reachability gaps, drawn on a shared 0–100 scale.
 *
 * Sequential, one hue: these are magnitudes, not identities, so colouring each
 * bar differently would spend the identity channel re-encoding the length. A
 * gap the model could not measure is hatched rather than short — "we do not
 * know" and "there is no gap" are opposite readings and must not share a mark.
 */
export function GapBars({ gaps, className }: { gaps: GapDatum[]; className?: string }) {
  const hatch = useId();

  return (
    <div className={cn("space-y-2", className)}>
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <pattern id={hatch} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--muted)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted-foreground)" strokeWidth="2" strokeOpacity="0.35" />
          </pattern>
        </defs>
      </svg>

      {gaps.map((g) => (
        <div key={g.label} className="min-w-0" title={g.detail}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] text-muted-foreground">{g.label}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {g.known ? Math.round(g.size) : "unknown"}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${String(Math.max(2, Math.min(100, g.size)))}%`,
                background: g.known ? "var(--primary)" : `url(#${hatch})`,
                opacity: g.known ? 0.35 + (g.size / 100) * 0.65 : 1,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Range bar — fastest / expected / slower
 * ---------------------------------------------------------------------- */

/**
 * A span with a marker, for an estimate that is honestly a range.
 *
 * Drawing the whole span is the point: a single "90 days" invites being put in
 * a calendar, and this cannot be. The marker says where the middle of the
 * estimate sits without hiding how wide it is.
 */
export function RangeBar({
  fastest,
  expected,
  slower,
  max,
  className,
}: {
  fastest: number;
  expected: number;
  slower: number;
  max: number;
  className?: string;
}) {
  const pos = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));

  return (
    <div
      className={cn("relative h-1.5 w-full rounded-full bg-muted", className)}
      title={`${String(fastest)}–${String(slower)} days, expected ${String(expected)}`}
    >
      <div
        className="absolute inset-y-0 rounded-full bg-primary/25"
        style={{ left: `${String(pos(fastest))}%`, right: `${String(100 - pos(slower))}%` }}
      />
      <div
        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
        style={{ left: `${String(pos(expected))}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Impact × effort scatter
 * ---------------------------------------------------------------------- */

export type MatrixPoint = {
  id: string;
  title: string;
  /** 0–100. */
  impact: number;
  effort: "low" | "medium" | "high";
  kind: string;
};

const EFFORT_X: Record<MatrixPoint["effort"], number> = {
  low: 0.18,
  medium: 0.5,
  high: 0.82,
};

/**
 * Every opportunity placed by what it costs and what it returns.
 *
 * This replaced a two-by-two grid of bullet lists — which is a scatter plot
 * with the plotting left undone, and which forced the reader to count list
 * lengths to compare quadrants.
 *
 * One hue for every point, deliberately. A scatter is an all-pairs form, where
 * any two marks can end up adjacent, and that caps a safe categorical palette
 * at about three series; there are seven kinds of opportunity here. Encoding
 * kind by colour would fail quietly for colour-blind readers, so kind lives in
 * the tooltip and impact rides the dot size instead.
 */
export function ImpactEffortMatrix({
  points,
  onSelect,
  className,
}: {
  points: MatrixPoint[];
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const [hover, setHover] = useState<MatrixPoint | null>(null);

  const w = 520;
  const h = 300;
  const pad = { top: 18, right: 18, bottom: 30, left: 44 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const x = (e: MatrixPoint["effort"]) => pad.left + EFFORT_X[e] * plotW;
  const y = (impact: number) => pad.top + (1 - Math.max(0, Math.min(100, impact)) / 100) * plotH;

  /*
   * Spread points that share a cell, so a stack of ten does not read as one.
   *
   * Placed on a phyllotaxis spiral rather than a row-and-column grid. Many
   * opportunities score identically — every blocked page lands on the same
   * impact — and laying those out in rows produced something that read as a
   * printed table of dots rather than a distribution. The spiral fills a disc
   * evenly and, being seeded from the index, is stable across renders.
   */
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const placed = points.map((p, i) => {
    const siblings = points.filter(
      (o) => o.effort === p.effort && Math.abs(o.impact - p.impact) < 5,
    );
    const index = Math.max(0, siblings.indexOf(p));
    const spread = siblings.length <= 1 ? 0 : Math.sqrt(index) * 7.5;
    const angle = index * GOLDEN;

    return {
      p,
      cx: x(p.effort) + Math.cos(angle) * spread,
      cy: y(p.impact) + Math.sin(angle) * spread * 0.62,
      key: `${p.id}-${String(i)}`,
    };
  });

  const midX = pad.left + plotW / 2;
  const midY = pad.top + plotH / 2;

  return (
    <div className={cn("relative w-full", className)}>
      <svg
        viewBox={`0 0 ${String(w)} ${String(h)}`}
        className="h-[300px] w-full"
        role="img"
        aria-label="Opportunities plotted by impact against effort"
        onMouseLeave={() => {
          setHover(null);
        }}
      >
        {/*
          * One wash, on the quadrant that is actually the recommendation.
          *
          * Two washes across the top half made the plot look as though it ended
          * at the midline — the unwashed bottom read as margin rather than as
          * the low-impact half of the data.
          */}
        <rect
          x={pad.left}
          y={pad.top}
          width={plotW / 2}
          height={plotH / 2}
          fill="var(--success)"
          opacity="0.06"
        />

        <line x1={midX} x2={midX} y1={pad.top} y2={pad.top + plotH} stroke="var(--border)" strokeWidth="1" />
        <line x1={pad.left} x2={pad.left + plotW} y1={midY} y2={midY} stroke="var(--border)" strokeWidth="1" />

        <text x={pad.left + 8} y={pad.top + 14} className="fill-muted-foreground text-[10px] uppercase tracking-wide">
          Quick wins
        </text>
        <text x={midX + 8} y={pad.top + 14} className="fill-muted-foreground text-[10px] uppercase tracking-wide">
          Strategic
        </text>
        <text x={pad.left + 8} y={pad.top + plotH - 8} className="fill-muted-foreground text-[10px] uppercase tracking-wide">
          Maintain
        </text>
        <text x={midX + 8} y={pad.top + plotH - 8} className="fill-muted-foreground text-[10px] uppercase tracking-wide">
          Deprioritise
        </text>

        <text x={pad.left - 8} y={pad.top + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
          High
        </text>
        <text x={pad.left - 8} y={pad.top + plotH} textAnchor="end" className="fill-muted-foreground text-[10px]">
          Low
        </text>
        <text
          x={pad.left - 30}
          y={pad.top + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${String(pad.left - 30)} ${String(pad.top + plotH / 2)})`}
          className="fill-muted-foreground text-[10px] uppercase tracking-wide"
        >
          Impact
        </text>

        {(["low", "medium", "high"] as const).map((e) => (
          <text key={e} x={x(e)} y={h - 10} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {e} effort
          </text>
        ))}

        {placed.map(({ p, cx, cy, key }) => {
          const r = 4 + (p.impact / 100) * 5;
          return (
            <g key={key}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="var(--primary)"
                fillOpacity={hover?.id === p.id ? 0.95 : 0.62}
                stroke="var(--card)"
                strokeWidth="2"
              />
              {/*
               * A transparent 24px target over an 8px dot. A scatter point is a
               * pinpoint nobody hits reliably, and the hover is where the kind
               * and the impact figure live.
               */}
              <circle
                cx={cx}
                cy={cy}
                r={12}
                fill="transparent"
                className={onSelect ? "cursor-pointer" : undefined}
                onMouseEnter={() => {
                  setHover(p);
                }}
                onFocus={() => {
                  setHover(p);
                }}
                onClick={() => onSelect?.(p.id)}
                tabIndex={0}
                role={onSelect ? "button" : undefined}
                aria-label={`${p.title}. Impact ${String(Math.round(p.impact))} of 100, ${p.effort} effort.`}
              />
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div className="pointer-events-none absolute left-1/2 top-2 max-w-[85%] -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
          <p className="text-sm font-semibold leading-snug">{hover.title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Impact {Math.round(hover.impact)}/100 · {hover.effort} effort · {hover.kind.replace(/-/g, " ")}
          </p>
        </div>
      )}
    </div>
  );
}
