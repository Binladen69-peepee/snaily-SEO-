import { AlertCircle, Search, SearchX } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/** Row-shaped, because it stands in for the keyword table. */
export function ResultsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading keywords">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
        <Skeleton className="size-3.5" />
        <Skeleton className="h-3 w-28" />
        <div className="flex-1" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-8" />
      </div>
      {Array.from({ length: 14 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border/70 px-3 py-2"
        >
          <Skeleton className="size-3.5" />
          <Skeleton className="h-3.5" style={{ width: `${String(35 + ((i * 7) % 40))}%` }} />
          <div className="flex-1" />
          <Skeleton className="h-3.5 w-10" />
          <Skeleton className="h-3.5 w-8" />
          <Skeleton className="h-4 w-9 rounded" />
        </div>
      ))}
    </div>
  );
}

export function StartState() {
  return (
    <div className="px-4 py-10">
      <EmptyState
        icon={Search}
        title="Search for a keyword"
        description="Enter a topic above to see search volume, difficulty and related ideas."
      />
    </div>
  );
}

export function NoResultsState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="px-4 py-10">
      <EmptyState
        icon={SearchX}
        title="No keywords found"
        description={
          hasFilters
            ? "Try widening or clearing your filters."
            : "Try a broader or more common search term."
        }
      />
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-3">
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded border border-destructive/40 bg-destructive/5 px-4 py-14 text-center"
      >
        <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="size-5 text-destructive" aria-hidden />
        </div>
        <div className="max-w-sm space-y-1">
          <p className="font-medium text-destructive">Could not load keywords</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}
