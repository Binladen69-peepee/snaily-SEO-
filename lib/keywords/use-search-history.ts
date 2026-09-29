"use client";

import { useCallback, useEffect, useState } from "react";

import type { HistoryItem } from "@/lib/keywords/history";

/**
 * Client-side hook for search history. Fetches once on mount, then exposes
 * the list and a record() helper any search component can call.
 */
export function useSearchHistory() {
  const [items, setItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    fetch("/api/keywords/history")
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((d: { history?: HistoryItem[] }) => {
        setItems(d.history ?? []);
      })
      .catch(() => {});
  }, []);

  const record = useCallback(
    (keyword: string, country: string, resultCount: number) => {
      fetch("/api/keywords/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, country, resultCount }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { history?: HistoryItem[] } | null) => {
          if (d?.history) setItems(d.history);
        })
        .catch(() => {});
    },
    [],
  );

  return { items, record };
}
