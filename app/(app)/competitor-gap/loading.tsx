import { Skeleton } from "@/components/ui/skeleton";

export default function CompetitorGapLoading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5" aria-busy="true" aria-label="Loading competitor gap">
      {/* page header */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* comparison form */}
      <Skeleton className="h-32 rounded-xl" />

      {/* stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>

      {/* gap table */}
      <Skeleton className="h-64 rounded-xl" />

      {/* shared table */}
      <Skeleton className="h-48 rounded-xl" />

      {/* your edge table */}
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
