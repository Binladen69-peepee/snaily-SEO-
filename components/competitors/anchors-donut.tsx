"use client";

/**
 * Keysearch-style donut for top anchor text distribution.
 * Pure SVG — no chart library dependency.
 */

const COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a78bfa",
  "#93c5fd",
  "#64748b",
];

export function AnchorsDonut({
  items,
}: {
  items: { text: string; count: number }[];
}) {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (total === 0 || items.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">
        No anchor text found yet.
      </p>
    );
  }

  const R = 54;
  const CX = 70;
  const CY = 70;
  const stroke = 22;
  const C = 2 * Math.PI * R;

  let offset = 0;
  const slices = items.slice(0, 6).map((item, i) => {
    const frac = item.count / total;
    const len = frac * C;
    const slice = {
      ...item,
      color: COLORS[i % COLORS.length]!,
      dash: `${len.toFixed(2)} ${(C - len).toFixed(2)}`,
      offset: -offset,
      pct: Math.round(frac * 100),
    };
    offset += len;
    return slice;
  });

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center">
      <svg
        viewBox="0 0 140 140"
        className="mx-auto size-36 shrink-0"
        role="img"
        aria-label="Top anchor text distribution"
      >
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted"
        />
        {slices.map((s) => (
          <circle
            key={s.text}
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={s.dash}
            strokeDashoffset={s.offset}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        ))}
        <text
          x={CX}
          y={CY - 2}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: "18px", fontWeight: 700 }}
        >
          {String(items.length)}
        </text>
        <text
          x={CX}
          y={CY + 14}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: "9px" }}
        >
          anchors
        </text>
      </svg>

      <ul className="min-w-0 flex-1 space-y-2">
        {slices.map((s) => (
          <li key={s.text} className="flex items-center gap-2 text-[12px]">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: s.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate" title={s.text}>
              {s.text}
            </span>
            <span className="tabular shrink-0 text-muted-foreground">
              {s.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
