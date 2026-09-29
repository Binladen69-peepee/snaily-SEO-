import { Skeleton } from "@/components/ui/skeleton";

export default function TrackingLoading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-5" aria-busy="true" aria-label="Loading rank tracker">
      {/* heading row */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* summary tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>

      {/* chart area */}
      <Skeleton className="h-56 rounded-xl" />

      {/* keywords table */}
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-md" />
        ))}
      </div>
    </div>
  );
}
