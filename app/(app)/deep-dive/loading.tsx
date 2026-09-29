import { Skeleton } from "@/components/ui/skeleton";

export default function DeepDiveLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading deep dive">
      {/* heading row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-6 w-32 rounded-full" />
      </div>

      {/* search bar + source picker */}
      <Skeleton className="h-12 rounded-lg" />

      {/* results table */}
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
