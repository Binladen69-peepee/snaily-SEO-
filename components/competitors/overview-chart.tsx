"use client";

const MONTHS = [
  "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec", "Jan", "Feb",
];

/** Soft blue–purple area chart for backlinks / traffic overview. */
export function OverviewChart({
  values,
  height = 180,
}: {
  values: number[];
  height?: number;
}) {
  if (values.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No trend data yet.
      </p>
    );
  }

  const max = Math.max(...values, 1);
  const n = values.length;
  const w = 560;
  const h = height;
  const padX = 8;
  const padY = 12;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const points = values.map((v, i) => {
    const x = padX + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = padY + plotH - (v / max) * plotH;
    return { x, y };
  });

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const area = [
    line,
    `L ${points[n - 1]!.x.toFixed(1)} ${(padY + plotH).toFixed(1)}`,
    `L ${points[0]!.x.toFixed(1)} ${(padY + plotH).toFixed(1)}`,
    "Z",
  ].join(" ");

  const ticks = [max, Math.round(max / 2), 0];

  return (
    <div className="flex gap-2">
      <div
        className="flex shrink-0 flex-col justify-between py-1 text-right text-[10px] tabular text-muted-foreground"
        style={{ height }}
        aria-hidden
      >
        {ticks.map((t) => (
          <span key={t}>{t.toLocaleString("en-US")}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${String(w)} ${String(h)}`}
          className="w-full"
          style={{ height }}
          preserveAspectRatio="none"
          role="img"
          aria-label="Backlinks trend over 12 months"
        >
          <defs>
            <linearGradient id="blFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.15" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((t) => {
            const y = padY + plotH * (1 - t);
            return (
              <line
                key={t}
                x1={padX}
                x2={w - padX}
                y1={y}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
            );
          })}
          {/* Fill fades in while the line draws itself left to right. */}
          <path d={area} fill="url(#blFill)" className="chart-area" />
          <path
            d={line}
            fill="none"
            stroke="#4f46e5"
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            className="chart-line"
          />
        </svg>
        <div className="mt-0.5 flex justify-between px-0.5" aria-hidden>
          {MONTHS.map((m, i) => (
            <span
              key={m}
              className="text-[10px] text-muted-foreground"
              style={{ width: `${String(100 / 12)}%`, textAlign: "center" }}
            >
              {i % 2 === 0 ? m : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
