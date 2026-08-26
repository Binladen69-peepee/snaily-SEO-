"use client";

/**
 * Drag-to-resize for the editor's side panels.
 *
 * The panels hold things of very different widths — a slug, a list of
 * ingredients, a SERP breakdown — and one fixed width cannot suit all of them.
 * A writer on a wide screen wants the research panel open and generous; one on
 * a laptop wants it out of the way.
 *
 * The width is per panel and per browser, remembered across reloads, because a
 * layout you have to rebuild every visit is worse than one that never moved.
 * Nothing here is shared between viewers, so localStorage is the right home for
 * it: losing it costs a drag, not data.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type PanelSide = "left" | "right";

type Options = {
  /** Storage key suffix, so two panels never collide. */
  id: string;
  side: PanelSide;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
};

const STORAGE_PREFIX = "snaily.panel.";

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Panel width plus the drag handling that changes it.
 *
 * Returns the width to apply and the props for a handle. The width is only
 * applied above the breakpoint where the panels sit side by side; below it they
 * are full-width sheets and a pixel width would fight the layout.
 */
export function useResizablePanel({
  id,
  side,
  defaultWidth,
  minWidth = 260,
  maxWidth = 720,
}: Options) {
  const [width, setWidth] = useState(defaultWidth);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<number | null>(null);

  // Read the stored width after mount: the server has no localStorage, and
  // rendering a remembered width on the server would mismatch the client.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${id}`);
      if (raw === null) return;
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        setWidth(clampWidth(parsed, minWidth, maxWidth));
      }
    } catch {
      // A browser refusing storage is not a reason to fail to render.
    }
  }, [id, minWidth, maxWidth]);

  const persist = useCallback(
    (next: number) => {
      try {
        window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, String(next));
      } catch {
        // Ignore: the panel still works, it just will not be remembered.
      }
    },
    [id],
  );

  const apply = useCallback(
    (next: number) => {
      const clamped = clampWidth(next, minWidth, maxWidth);
      setWidth(clamped);
      return clamped;
    },
    [minWidth, maxWidth],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      setDragging(true);

      const startX = event.clientX;
      const startWidth = width;

      const move = (e: PointerEvent) => {
        // A left panel grows as the pointer moves right; a right panel grows
        // as it moves left. Same gesture, opposite sign.
        const delta = side === "left" ? e.clientX - startX : startX - e.clientX;
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          apply(startWidth + delta);
        });
      };

      const up = () => {
        handle.releasePointerCapture(event.pointerId);
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        // Read the applied width off state on the next tick rather than
        // recomputing it, so what is stored is exactly what is shown.
        setWidth((current) => {
          persist(current);
          return current;
        });
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [apply, persist, side, width],
  );

  /** Arrow keys move the edge, so the panel is resizable without a pointer. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 48 : 16;
      let next: number | null = null;

      if (event.key === "ArrowLeft") {
        next = side === "left" ? width - step : width + step;
      } else if (event.key === "ArrowRight") {
        next = side === "left" ? width + step : width - step;
      } else if (event.key === "Home") {
        next = defaultWidth;
      }

      if (next === null) return;
      event.preventDefault();
      persist(apply(next));
    },
    [apply, defaultWidth, persist, side, width],
  );

  const reset = useCallback(() => {
    persist(apply(defaultWidth));
  }, [apply, defaultWidth, persist]);

  return { width, dragging, onPointerDown, onKeyDown, reset, minWidth, maxWidth };
}

/**
 * The draggable edge.
 *
 * Two pixels of visible line, but a much wider hit area — a 2px target is a
 * test of aim rather than a control. It only exists at the breakpoint where
 * the panel is docked.
 */
export function ResizeHandle({
  side,
  dragging,
  width,
  minWidth,
  maxWidth,
  onPointerDown,
  onKeyDown,
  onReset,
  label,
}: {
  side: PanelSide;
  dragging: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onReset: () => void;
  label: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      title="Drag to resize · double-click to reset"
      className={cn(
        "absolute inset-y-0 z-20 hidden w-3 cursor-col-resize touch-none xl:block",
        // The handle straddles the border so the whole edge is grabbable.
        side === "left" ? "-right-1.5" : "-left-1.5",
        "focus-visible:outline-none",
      )}
    >
      <div
        className={cn(
          "mx-auto h-full w-0.5 transition-colors",
          dragging ? "bg-primary" : "bg-transparent hover:bg-primary/40",
        )}
      />
    </div>
  );
}
