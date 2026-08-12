"use client";

import { useEffect, useState } from "react";

/**
 * Semi-circular domain-strength gauge, 0–10.
 *
 * The viewBox is sized to the drawn geometry rather than a round number, so
 * the stroke cannot clip against the card edge and the gauge scales to whatever
 * width the card gives it instead of leaving dead space beside it.
 */

const R = 46;
const STROKE = 11;
const CX = 60;
const CY = 56;

/** Half the stroke overhangs the path, and the round cap adds a little more. */
const PAD = STROKE / 2 + 1;
const VB_W = CX * 2;
const VB_H = CY + PAD + 14; // room under the arc for the 0 / 10 labels

function arc(from: number, to: number): string {
  const x1 = CX + R * Math.cos(from);
  const y1 = CY + R * Math.sin(from);
  const x2 = CX + R * Math.cos(to);
  const y2 = CY + R * Math.sin(to);
  const large = Math.abs(to - from) > Math.PI ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${String(R)} ${String(R)} 0 ${String(large)} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Length of the full half-circle, used to animate the fill by dash offset. */
const TRACK_LENGTH = Math.PI * R;

function toneFor(value: number): string {
  if (value >= 7) return "text-success";
  if (value >= 4) return "text-warning";
  return "text-destructive";
}

export function DomainGauge({
  value,
  domain,
}: {
  value: number;
  domain: string;
}) {
  const clamped = Math.max(0, Math.min(10, value));

  // Animate from empty on mount so the arc sweeps into place and the number
  // counts up, rather than snapping to its final state.
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setShown(clamped);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [clamped]);

  const filled = (shown / 10) * TRACK_LENGTH;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-3 py-3">
      <p
        className="max-w-full truncate text-center text-[11px] text-muted-foreground"
        title={domain}
      >
        {domain}
      </p>

      <svg
        viewBox={`0 0 ${String(VB_W)} ${String(VB_H)}`}
        className="w-full max-w-[11rem]"
        role="img"
        aria-label={`Domain strength ${clamped.toFixed(1)} out of 10`}
      >
        <path
          d={arc(Math.PI, 0)}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className="text-muted"
        />
        <path
          d={arc(Math.PI, 0)}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className={`${toneFor(clamped)} transition-[stroke-dasharray] duration-1000 ease-out`}
          strokeDasharray={`${filled.toFixed(2)} ${String(TRACK_LENGTH)}`}
        />

        <text
          x={CX}
          y={CY - 2}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: "26px", fontWeight: 700 }}
        >
          {clamped.toFixed(1)}
        </text>

        <text
          x={CX - R}
          y={CY + PAD + 11}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: "9px" }}
        >
          0
        </text>
        <text
          x={CX + R}
          y={CY + PAD + 11}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: "9px" }}
        >
          10
        </text>
      </svg>

      <p className="text-xs font-medium text-muted-foreground">Domain Strength</p>
    </div>
  );
}
