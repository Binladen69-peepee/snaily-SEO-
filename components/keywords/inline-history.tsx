"use client";

import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { HistoryItem } from "@/lib/keywords/history";

/**
 * Compact history panel that drops below a search input. Shows the most recent
 * searches as clickable rows. Sits in the same absolute z-layer as the
 * typeahead dropdown so only one is visible at a time.
 */
export function InlineHistory({
  items,
  onSelect,
  className,
}: {
  items: HistoryItem[];
  onSelect: (keyword: string, country: string) => void;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <Clock className="size-3" aria-hidden />
        Recent searches
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {items.slice(0, 8).map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item.keyword, item.country);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Clock className="size-3 shrink-0 opacity-40" aria-hidden />
              <span className="flex-1 truncate">{item.keyword}</span>
              <span className="rounded bg-muted px-1 text-[10px] uppercase">
                {item.country}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
