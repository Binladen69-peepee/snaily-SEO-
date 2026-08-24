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

/*
 * One colour at every value, matching the reference. A red arc on a low score
 * reads as an error rather than a measurement — the number already says where
 * the domain sits on the scale.
 */
function toneFor(): string {
  return "text-success";
}

export function DomainGauge({
  value,
  domain,
}: {
  /** Null when no link-graph or SERP signal could be read for this domain. */
  value: number | null;
  domain: string;
}) {
  const known = value !== null;
  const clamped = Math.max(0, Math.min(10, value ?? 0));

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
    /* Title left, domain right on one header row, then the dial centred below. */
    <div className="flex h-full flex-col px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">Domain Strength</h3>
        <p
          className="min-w-0 truncate text-[11px] text-muted-foreground"
          title={domain}
        >
          {domain}
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
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
            className={`${toneFor()} transition-[stroke-dasharray] duration-1000 ease-out`}
            strokeDasharray={`${filled.toFixed(2)} ${String(TRACK_LENGTH)}`}
          />

          <text
            x={CX}
            y={CY - 2}
            textAnchor="middle"
            className="fill-foreground"
            style={{ fontSize: known ? "26px" : "16px", fontWeight: 700 }}
          >
            {/* "0.0" would read as a measured zero rather than no reading at all. */}
            {known ? clamped.toFixed(1) : "N/A"}
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
      </div>
    </div>
  );
}
