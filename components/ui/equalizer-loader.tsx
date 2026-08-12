"use client";

import { cn } from "@/lib/utils";

/**
 * Equaliser loader — bars that pulse from their centre, so both ends travel
 * rather than only the top edge growing upwards.
 *
 * Deliberately small: a page-level spinner should read as "working", not
 * dominate the empty space it sits in.
 */
export function EqualizerLoader({
  label = "Loading…",
  className,
  size = "md",
}: {
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const trackH = size === "lg" ? "h-7" : size === "sm" ? "h-4" : "h-5";
  const barW = size === "lg" ? "w-1" : "w-0.5";
  const gap = size === "lg" ? "gap-1" : "gap-0.5";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-6",
        className,
      )}
    >
      {/* items-center so the pulse is symmetrical about the midline. */}
      <div
        className={cn("flex items-center justify-center", trackH, gap)}
        aria-hidden
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn("eq-bar rounded-full bg-primary", barW, trackH)}
            style={{ animationDelay: `${String(i * 0.1)}s` }}
          />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Compact inline spinner for buttons and table cells. */
export function EqualizerInline({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex h-3.5 items-center gap-px", className)}
      aria-hidden
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="eq-bar inline-block h-3.5 w-0.5 rounded-full bg-current"
          style={{ animationDelay: `${String(i * 0.1)}s` }}
        />
      ))}
    </span>
  );
}
