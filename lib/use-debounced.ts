"use client";

import { useEffect, useState } from "react";

/**
 * A value that lags behind, so expensive work does not run per keystroke.
 *
 * Content Library filters and re-renders six hundred rows; doing that on every
 * character makes the search box feel like it is fighting the typist. The
 * *input* stays instant — only the value the filter reads is delayed.
 *
 * The timer resets on each change, so a fast typist triggers exactly one pass
 * when they stop rather than one per letter.
 */
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
}
