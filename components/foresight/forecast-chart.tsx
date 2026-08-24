"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Table2, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * History, the do-nothing baseline, the forecast, and the range.
 *
 * Drawn as an emphasis chart rather than a categorical one: the forecast is the
 * point, so it carries the only hue on the plot, the baseline recedes to a grey
 * dash, and history is plain ink. Colouring three series three ways would make
 * the reader work out which line the chart is about — and the chart is about
 * one of them.
 *
 * The shaded wedge between the baseline and the forecast is the incremental
 * figure, drawn where the eye already is. That is the number worth deciding on,
 * and reading it off two separate lines is arithmetic nobody does.
 *
 * The band behind everything is P10–P90 and is deliberately wide. A tight band
 * around a forecast built on eight weeks of data would look like precision.
 */

export type ChartMonth = {
  month: string;
  baseline: number;
  expected: number;
  p10?: number | null;
  p90?: number | null;
};

export type ChartHistory = { month: string; clicks: number };

const W = 880;
const H = 300;
const PAD = { top: 20, right: 64, bottom: 32, left: 52 };

function monthLabel(iso: string, long = false): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    ...(long ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const stepped = Math.ceil(value / magnitude) * magnitude;
  return stepped === value ? stepped * 1.1 : stepped;
}

type Point = {
  month: string;
  actual: number | null;
  baseline: number | null;
  expected: number | null;
  p10: number | null;
  p90: number | null;
};

export function ForecastChart({
  history,
  months,
  className,
}: {
  history: ChartHistory[];
  months: ChartMonth[];
  className?: string;
}) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const svgRef = useRef<SVGSVGElement>(null);

  const points: Point[] = useMemo(() => {
    const lastActual = history.at(-1)?.clicks ?? null;

    const past: Point[] = history.map((h) => ({
      month: h.month,
      actual: h.clicks,
      baseline: null,
      expected: null,
      p10: null,
      p90: null,
    }));

    // The forecast joins the last measured point so the lines meet rather than
    // leaving a gap the reader has to bridge.
    if (past.length > 0 && months.length > 0) {
      const tail = past[past.length - 1]!;
      tail.baseline = lastActual;
      tail.expected = lastActual;
      tail.p10 = lastActual;
      tail.p90 = lastActual;
    }

    return [
      ...past,
      ...months.map((m) => ({
        month: m.month,
        actual: null,
        baseline: m.baseline,
        expected: m.expected,
        p10: m.p10 ?? null,
        p90: m.p90 ?? null,
      })),
    ];
  }, [history, months]);

  if (points.length === 0) {
    return (
      <div
        className={cn(
          "flex h-[300px] items-center justify-center rounded-xl border border-dashed border-border p-6 text-center",
          className,
        )}
      >
        <p className="max-w-sm text-sm text-muted-foreground">
          Nothing to plot yet. A traffic chart needs measured clicks to project
          from, and none have been synced for this project.
        </p>
      </div>
    );
  }

  const n = points.length;
  const max = niceMax(
    Math.max(
      1,
      ...points.map((p) =>
        Math.max(p.actual ?? 0, p.baseline ?? 0, p.expected ?? 0, p.p90 ?? 0),
      ),
    ),
  );

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (Math.max(0, v) / max) * plotH;

  const path = (get: (p: Point) => number | null): string => {
    let d = "";
    let open = false;
    points.forEach((p, i) => {
      const v = get(p);
      if (v === null) {
        open = false;
        return;
      }
      d += `${open ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      open = true;
    });
    return d.trim();
  };

  const areaBetween = (
    top: (p: Point) => number | null,
    bottom: (p: Point) => number | null,
  ): string => {
    const upper = points.map((p, i) => ({ v: top(p), i })).filter((s) => s.v !== null);
    const lower = points.map((p, i) => ({ v: bottom(p), i })).filter((s) => s.v !== null);
    if (upper.length === 0 || lower.length === 0) return "";
    return `${upper.map((s, k) => `${k === 0 ? "M" : "L"} ${x(s.i).toFixed(1)} ${y(s.v!).toFixed(1)}`).join(" ")} ${[...lower]
      .reverse()
      .map((s) => `L ${x(s.i).toFixed(1)} ${y(s.v!).toFixed(1)}`)
      .join(" ")} Z`;
  };

  const bandPath = areaBetween((p) => p.p90, (p) => p.p10);
  const wedgePath = areaBetween((p) => p.expected, (p) => p.baseline);

  const forecastStart = history.length - 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  const lastPoint = points[n - 1]!;
  const active = hoverIndex === null ? null : points[hoverIndex];

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (svg === null) return;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    // The crosshair snaps to the nearest month: readers aim at a date, never at
    // a two-pixel line.
    const i = Math.round(((px - PAD.left) / plotW) * (n - 1));
    setHoverIndex(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <Legend colour="var(--foreground)">Actual</Legend>
          <Legend colour="var(--muted-foreground)" dashed>
            If you do nothing
          </Legend>
          <Legend colour="var(--primary)">Forecast</Legend>
          {bandPath !== "" && (
            <Legend colour="var(--primary)" block>
              P10–P90
            </Legend>
          )}
        </div>

        <div className="flex rounded-md border border-input p-0.5">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setView(v);
              }}
              aria-pressed={view === v}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                view === v
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "chart" ? <TrendingUp className="size-3" /> : <Table2 className="size-3" />}
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>

      {view === "table" ? (
        <div className="max-h-[300px] overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Month</th>
                <th className="px-3 py-2 text-right font-medium">Actual</th>
                <th className="px-3 py-2 text-right font-medium">Do nothing</th>
                <th className="px-3 py-2 text-right font-medium">Forecast</th>
                <th className="px-3 py-2 text-right font-medium">P10–P90</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.month} className="border-t border-border">
                  <td className="px-3 py-1.5">{monthLabel(p.month, true)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {p.actual === null ? "—" : p.actual.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {p.baseline === null ? "—" : Math.round(p.baseline).toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                    {p.expected === null ? "—" : Math.round(p.expected).toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {p.p10 === null || p.p90 === null
                      ? "—"
                      : `${Math.round(p.p10).toLocaleString()}–${Math.round(p.p90).toLocaleString()}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative w-full overflow-x-auto">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${String(W)} ${String(H)}`}
            className="h-[300px] w-full min-w-[560px] touch-none"
            role="img"
            aria-label="Historical clicks with the do-nothing baseline and the forecast range"
            onPointerMove={onMove}
            onPointerLeave={() => {
              setHoverIndex(null);
            }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.14" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={PAD.left - 10}
                  y={y(t) + 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {t.toLocaleString()}
                </text>
              </g>
            ))}

            {bandPath !== "" && <path d={bandPath} fill={`url(#${gradientId})`} />}
            {wedgePath !== "" && (
              <path d={wedgePath} fill="var(--primary)" fillOpacity="0.1" />
            )}

            {/* Dashed here because it genuinely marks "everything right of this
                is projected" — the one place a dash carries meaning. */}
            {forecastStart >= 0 && months.length > 0 && (
              <line
                x1={x(forecastStart)}
                x2={x(forecastStart)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--muted-foreground)"
                strokeOpacity="0.45"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            )}

            <path
              d={path((p) => p.baseline)}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeWidth="2"
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
            <path
              d={path((p) => p.actual)}
              fill="none"
              stroke="var(--foreground)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={path((p) => p.expected)}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* One direct label, on the thing the chart is about. */}
            {lastPoint.expected !== null && (
              <>
                <circle
                  cx={x(n - 1)}
                  cy={y(lastPoint.expected)}
                  r="4.5"
                  fill="var(--primary)"
                  stroke="var(--card)"
                  strokeWidth="2"
                />
                <text
                  x={x(n - 1) + 10}
                  y={y(lastPoint.expected) + 4}
                  className="fill-foreground text-[11px] font-semibold"
                >
                  {Math.round(lastPoint.expected).toLocaleString()}
                </text>
              </>
            )}

            {active !== null && (
              <g>
                <line
                  x1={x(hoverIndex!)}
                  x2={x(hoverIndex!)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="var(--foreground)"
                  strokeOpacity="0.25"
                  strokeWidth="1"
                />
                {([
                  ["actual", active.actual, "var(--foreground)"],
                  ["baseline", active.baseline, "var(--muted-foreground)"],
                  ["expected", active.expected, "var(--primary)"],
                ] as const).map(([key, v, colour]) =>
                  v === null ? null : (
                    <circle
                      key={key}
                      cx={x(hoverIndex!)}
                      cy={y(v)}
                      r="4"
                      fill={colour}
                      stroke="var(--card)"
                      strokeWidth="2"
                    />
                  ),
                )}
              </g>
            )}

            {points.map((p, i) =>
              i % Math.max(1, Math.ceil(n / 10)) === 0 || i === n - 1 ? (
                <text
                  key={p.month}
                  x={x(i)}
                  y={H - 10}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {monthLabel(p.month)}
                </text>
              ) : null,
            )}
          </svg>

          {active !== null && (
            <div
              className="pointer-events-none absolute top-2 rounded-lg border border-border bg-popover px-3 py-2 shadow-lg"
              style={{
                left: `${String(Math.min(78, Math.max(2, ((x(hoverIndex!) - PAD.left) / plotW) * 100)))}%`,
              }}
            >
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {monthLabel(active.month, true)}
              </p>
              <dl className="mt-1 space-y-0.5">
                <Row colour="var(--foreground)" label="Actual" value={active.actual} />
                <Row colour="var(--muted-foreground)" label="Do nothing" value={active.baseline} dashed />
                <Row colour="var(--primary)" label="Forecast" value={active.expected} />
                {active.p10 !== null && active.p90 !== null && (
                  <div className="pt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    Range {Math.round(active.p10).toLocaleString()}–
                    {Math.round(active.p90).toLocaleString()}
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Values lead, labels follow — here the reader already has the series. */
function Row({
  colour,
  label,
  value,
  dashed = false,
}: {
  colour: string;
  label: string;
  value: number | null;
  dashed?: boolean;
}) {
  if (value === null) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="inline-block h-0 w-3 shrink-0"
        style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${colour}` }}
        aria-hidden
      />
      <dd className="text-sm font-semibold tabular-nums">{Math.round(value).toLocaleString()}</dd>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
    </div>
  );
}

function Legend({
  colour,
  dashed = false,
  block = false,
  children,
}: {
  colour: string;
  dashed?: boolean;
  block?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {block ? (
        <span
          className="inline-block h-2.5 w-4 rounded-sm"
          style={{ backgroundColor: colour, opacity: 0.22 }}
        />
      ) : (
        <span
          className="inline-block h-0 w-4"
          style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${colour}` }}
        />
      )}
      {children}
    </span>
  );
}
