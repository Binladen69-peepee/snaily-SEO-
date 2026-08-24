"use client";

import { useId } from "react";

import type { PositionPoint, TrafficPoint } from "@/lib/domain-overview";
import { formatNumber } from "@/lib/keywords/format";

/**
 * Charts for the domain overview, drawn as plain SVG.
 *
 * The rest of the app draws its own charts rather than pulling in a plotting
 * library, and these follow suit. Every point is a real measured day: there is
 * no interpolation across gaps and no smoothing, because a smoothed line
 * implies data between the points that Search Console never reported.
 */

const VIEW_W = 600;
const PAD_X = 4;
const PAD_Y = 10;

/** Round a maximum up to something a human would put on an axis. */
function niceMax(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/** "2026-08-17" → "8/17". Short enough to fit several under a chart. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return m === undefined || d === undefined
    ? iso
    : `${String(Number(m))}/${String(Number(d))}`;
}

/** Up to `count` evenly spaced labels, always including first and last. */
function axisDates(dates: string[], count = 5): { at: number; label: string }[] {
  if (dates.length === 0) return [];
  if (dates.length <= count) {
    return dates.map((d, i) => ({ at: i, label: shortDate(d) }));
  }
  const step = (dates.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const at = Math.round(i * step);
    return { at, label: shortDate(dates[at]!) };
  });
}

function xAt(index: number, total: number, plotW: number): number {
  if (total <= 1) return PAD_X + plotW / 2;
  return PAD_X + (index / (total - 1)) * plotW;
}

function EmptyPlot({ height, children }: { height: number; children: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground"
      style={{ height }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Traffic                                                                     */
/* -------------------------------------------------------------------------- */

export function TrafficChart({
  points,
  height = 200,
}: {
  points: TrafficPoint[];
  height?: number;
}) {
  const gradientId = useId();

  if (points.length === 0) {
    return <EmptyPlot height={height}>No traffic recorded in this range.</EmptyPlot>;
  }

  const plotW = VIEW_W - PAD_X * 2;
  const plotH = height - PAD_Y * 2;
  const max = niceMax(Math.max(...points.map((p) => p.clicks), 1));

  const coords = points.map((p, i) => ({
    x: xAt(i, points.length, plotW),
    y: PAD_Y + plotH - (p.clicks / max) * plotH,
    point: p,
  }));

  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const baseline = PAD_Y + plotH;
  const area = `${line} L${coords.at(-1)!.x.toFixed(1)} ${baseline.toFixed(
    1,
  )} L${coords[0]!.x.toFixed(1)} ${baseline.toFixed(1)} Z`;

  const ticks = [max, max / 2, 0];

  return (
    <div>
      <div className="flex gap-2">
        <div
          className="tabular flex shrink-0 flex-col justify-between text-right text-[10px] text-muted-foreground"
          style={{ height }}
          aria-hidden
        >
          {ticks.map((t) => (
            <span key={t}>{formatNumber(Math.round(t))}</span>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${String(VIEW_W)} ${String(height)}`}
          height={height}
          className="min-w-0 flex-1"
          role="img"
          aria-label={`Clicks per day, peaking at ${formatNumber(
            Math.max(...points.map((p) => p.clicks)),
          )}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {ticks.map((t) => {
            const y = PAD_Y + plotH - (t / max) * plotH;
            return (
              <line
                key={t}
                x1={PAD_X}
                x2={VIEW_W - PAD_X}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth="1"
                className="text-border"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {coords.map((c) => (
            <circle key={c.point.date} cx={c.x} cy={c.y} r="6" fill="transparent">
              <title>
                {`${c.point.date}: ${formatNumber(c.point.clicks)} clicks · ${formatNumber(
                  c.point.impressions,
                )} impressions`}
              </title>
            </circle>
          ))}
        </svg>
      </div>

      <div className="tabular mt-1 flex justify-between pl-8 text-[10px] text-muted-foreground">
        {axisDates(points.map((p) => p.date)).map((d) => (
          <span key={d.at}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Keywords by position                                                        */
/* -------------------------------------------------------------------------- */

const BANDS = [
  { key: "top3", label: "Top 3", color: "#f59e0b" },
  { key: "four10", label: "#4 - 10", color: "#10b981" },
  { key: "eleven20", label: "#11 - 20", color: "#3b82f6" },
  { key: "beyond", label: "#20+", color: "#8b5cf6" },
] as const;

export function PositionChart({
  points,
  height = 200,
}: {
  points: PositionPoint[];
  height?: number;
}) {
  if (points.length === 0) {
    return (
      <EmptyPlot height={height}>
        No ranking positions recorded in this range.
      </EmptyPlot>
    );
  }

  const plotW = VIEW_W - PAD_X * 2;
  const plotH = height - PAD_Y * 2;
  const totals = points.map((p) => p.top3 + p.four10 + p.eleven20 + p.beyond);
  const max = niceMax(Math.max(...totals, 1));

  /*
   * Stacked from the top band down, each layer drawn as a filled band between
   * its own running total and the one below it — so the visible thickness of
   * a colour is that band's own count, not its cumulative total.
   */
  const running = points.map(() => 0);
  const layers = BANDS.map((band) => {
    const lower = running.slice();
    points.forEach((p, i) => {
      running[i] = lower[i]! + p[band.key];
    });
    const upper = running.slice();

    const y = (v: number) => PAD_Y + plotH - (v / max) * plotH;
    const top = upper
      .map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i, points.length, plotW).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(" ");
    const bottom = lower
      .map((v, i) => ({ v, i }))
      .reverse()
      .map(({ v, i }) => `L${xAt(i, points.length, plotW).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(" ");

    return { ...band, d: `${top} ${bottom} Z` };
  });

  const ticks = [max, max / 2, 0];

  return (
    <div>
      <ul className="mb-2 flex flex-wrap justify-end gap-x-4 gap-y-1">
        {BANDS.map((b) => (
          <li key={b.key} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: b.color }}
              aria-hidden
            />
            {b.label}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <div
          className="tabular flex shrink-0 flex-col justify-between text-right text-[10px] text-muted-foreground"
          style={{ height }}
          aria-hidden
        >
          {ticks.map((t) => (
            <span key={t}>{formatNumber(Math.round(t))}</span>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${String(VIEW_W)} ${String(height)}`}
          height={height}
          className="min-w-0 flex-1"
          role="img"
          aria-label="Ranked keywords per day, split by position band"
        >
          {ticks.map((t) => {
            const y = PAD_Y + plotH - (t / max) * plotH;
            return (
              <line
                key={t}
                x1={PAD_X}
                x2={VIEW_W - PAD_X}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth="1"
                className="text-border"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {layers.map((l) => (
            <path key={l.key} d={l.d} fill={l.color} fillOpacity="0.55" />
          ))}

          {points.map((p, i) => (
            <rect
              key={p.date}
              x={xAt(i, points.length, plotW) - 3}
              y={PAD_Y}
              width="6"
              height={plotH}
              fill="transparent"
            >
              <title>
                {`${p.date}: ${String(p.top3)} in top 3 · ${String(
                  p.four10,
                )} at 4-10 · ${String(p.eleven20)} at 11-20 · ${String(
                  p.beyond,
                )} beyond 20`}
              </title>
            </rect>
          ))}
        </svg>
      </div>

      <div className="tabular mt-1 flex justify-between pl-8 text-[10px] text-muted-foreground">
        {axisDates(points.map((p) => p.date)).map((d) => (
          <span key={d.at}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
