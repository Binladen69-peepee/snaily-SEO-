"use client";

import { Clock, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { HistoryItem } from "@/lib/keywords/history";

/** Shown before "show all" is pressed — enough to be useful, not a wall. */
const PREVIEW = 9;

export function SearchHistoryList({ items }: { items: HistoryItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  async function remove(id?: string) {
    setBusy(true);
    await fetch(`/api/keywords/history${id !== undefined ? `?id=${id}` : ""}`, {
      method: "DELETE",
    });
    setBusy(false);
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4" />
          Recent searches
        </div>
        <p className="text-sm text-muted-foreground">
          Your recent searches will appear here.
        </p>
      </div>
    );
  }

  const visible = showAll ? items : items.slice(0, PREVIEW);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4" />
          Recent searches
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void remove()}
        >
          Clear all
        </Button>
      </div>

      {/*
        A responsive grid rather than one long column — a dozen searches used
        to run the full height of the panel and push everything else off screen.
      */}
      <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((item) => (
          <li key={item.id} className="group relative">
            <Link
              href={`/keywords?q=${encodeURIComponent(item.keyword)}&country=${item.country}`}
              className="block rounded-md border border-transparent px-2.5 py-1.5 pr-7 transition-colors hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block truncate text-sm" title={item.keyword}>
                {item.keyword}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="rounded bg-muted px-1 uppercase">
                  {item.country}
                </span>
                {item.resultCount} results
                {item.searchCount > 1 && ` · ${item.searchCount}×`}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => void remove(item.id)}
              disabled={busy}
              aria-label={`Remove ${item.keyword} from history`}
              className="absolute right-1 top-1 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {items.length > PREVIEW && (
        <button
          type="button"
          onClick={() => {
            setShowAll((v) => !v);
          }}
          className="mt-2 text-xs text-primary hover:underline"
        >
          {showAll
            ? "Show fewer"
            : `Show all ${String(items.length)} searches`}
        </button>
      )}
    </div>
  );
}
