import { formatNumber } from "@/lib/keywords/format";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Ends on the current month, so the axis reads Mar → Mar like KeySearch's. */
function monthLabels(count: number): string[] {
  const now = new Date().getMonth();
  return Array.from(
    { length: count },
    (_, i) => MONTHS[(now - (count - 1 - i) + 120) % 12]!,
  );
}

/**
 * Smooth Catmull-Rom path through the points, converted to cubic béziers.
 *
 * A straight polyline looks nothing like KeySearch's chart, which curves
 * gently between months; this keeps the same shape without a chart library.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";

  let d = `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2 < points.length ? i + 2 : points.length - 1]!;

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}

/**
 * 12-month search interest, drawn as the filled area chart KeySearch shows.
 *
 * Values are normalised to 0–100 (Google Trends' own scale) so the y-axis
 * always reads 0–100 regardless of the keyword's absolute volume. The exact
 * monthly figures stay available to screen readers in the table below.
 */
export function TrendChart({ trend }: { trend: number[] }) {
  if (trend.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        No search trend data for this keyword.
      </p>
    );
  }

  const max = Math.max(...trend, 1);
  const scaled = trend.map((v) => Math.round((v / max) * 100));

  // Viewport in user units; the SVG scales to whatever width it is given.
  // The 1000×178 box gives roughly the same proportions as KeySearch's chart.
  const w = 1000;
  const h = 178;
  const padL = 30;
  const padR = 4;
  const padT = 8;
  const padB = 26;

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const points = scaled.map((v, i) => ({
    x: padL + (i / (scaled.length - 1 || 1)) * plotW,
    y: padT + (1 - v / 100) * plotH,
  }));

  const line = smoothPath(points);
  const area = `${line} L ${(padL + plotW).toFixed(2)} ${(padT + plotH).toFixed(2)} L ${padL.toFixed(2)} ${(padT + plotH).toFixed(2)} Z`;

  const ticks = [100, 80, 60, 40, 20, 0];
  const labels = monthLabels(trend.length);

  return (
    <div>
      {/*
        No preserveAspectRatio override: stretching the box would squash the
        axis labels. Width-only sizing lets the viewBox set the height.
      */}
      <svg
        viewBox={`0 0 ${String(w)} ${String(h)}`}
        className="w-full"
        role="img"
        aria-label="Relative search interest over the past 12 months"
      >
        <defs>
          {/* KeySearch's fill runs violet at the top into pale blue at the base. */}
          <linearGradient id="ks-trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.55 0.2 295)" stopOpacity="0.95" />
            <stop offset="55%" stopColor="oklch(0.62 0.17 275)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="oklch(0.8 0.09 240)" stopOpacity="0.12" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines + y-axis labels */}
        {ticks.map((t) => {
          const y = padT + (1 - t / 100) * plotH;
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={w - padR}
                y2={y}
                className="stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={padL - 7}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground"
                style={{ fontSize: 11 }}
              >
                {t}
              </text>
            </g>
          );
        })}

        {/* Vertical gridlines */}
        {points.map((p, i) => (
          <line
            key={i}
            x1={p.x}
            y1={padT}
            x2={p.x}
            y2={padT + plotH}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={area} fill="url(#ks-trend)" />
        <path
          d={line}
          fill="none"
          stroke="oklch(0.55 0.2 295)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />

        {/* Month labels */}
        {points.map((p, i) => (
          <text
            key={i}
            x={p.x}
            y={h - 8}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground"
            style={{ fontSize: 11 }}
          >
            {labels[i]}
          </text>
        ))}
      </svg>

      <table className="sr-only">
        <caption>Monthly search volume over the last 12 months</caption>
        <tbody>
          {trend.map((v, i) => (
            <tr key={i}>
              <th scope="row">{labels[i]}</th>
              <td>{formatNumber(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
