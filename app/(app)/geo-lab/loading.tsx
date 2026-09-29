import { Skeleton } from "@/components/ui/skeleton";

export default function GeoLabLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5" aria-busy="true" aria-label="Loading GEO lab">
      {/* heading */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* business facts card */}
      <Skeleton className="h-48 rounded-xl" />

      {/* ideas list */}
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
