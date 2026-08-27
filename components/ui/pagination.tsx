"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Page controls that report a page number and nothing else.
 *
 * The existing pagination pushed a route on /keywords, which made it unusable
 * anywhere else. This one takes a callback, so a screen holding its rows in
 * memory and a screen paging a query can both use it.
 */
export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  onPage,
  className,
  label = "results",
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onPage: (page: number) => void;
  className?: string;
  /** What is being counted, e.g. "posts". */
  label?: string;
}) {
  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="tabular">
        {total === 0
          ? `No ${label}`
          : `${String(first)}–${String(last)} of ${String(total)} ${label}`}
      </span>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={page <= 1}
            onClick={() => {
              onPage(page - 1);
            }}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="tabular px-1">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={page >= totalPages}
            onClick={() => {
              onPage(page + 1);
            }}
            aria-label="Next page"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
