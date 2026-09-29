import { Skeleton } from "@/components/ui/skeleton";

export default function BulkCheckLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-5" aria-busy="true" aria-label="Loading bulk check">
      {/* page header */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* textarea for keywords */}
      <Skeleton className="h-32 rounded-lg" />

      {/* action bar */}
      <Skeleton className="h-10 w-40 rounded-md" />

      {/* summary tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>

      {/* results table */}
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
