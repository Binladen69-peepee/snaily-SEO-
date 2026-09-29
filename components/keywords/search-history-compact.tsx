"use client";

import { Clock } from "lucide-react";

import type { HistoryItem } from "@/lib/keywords/history";

/**
 * Compact block of recent searches — a grid of clickable chips that sits
 * below empty-state prompts on Brainstorm, Deep Dive, Difficulty, etc.
 */
export function SearchHistoryCompact({
  items,
  onSelect,
}: {
  items: HistoryItem[];
  onSelect: (keyword: string, country: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Clock className="size-4" />
        Recent searches
      </div>
      <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
        {items.slice(0, 9).map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => {
                onSelect(item.keyword, item.country);
              }}
              className="block w-full rounded-md border border-transparent px-2.5 py-1.5 text-left transition-colors hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block truncate text-sm" title={item.keyword}>
                {item.keyword}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="rounded bg-muted px-1 uppercase">
                  {item.country}
                </span>
                {item.resultCount > 0 && `${item.resultCount} results`}
                {item.searchCount > 1 && ` · ${item.searchCount}×`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
