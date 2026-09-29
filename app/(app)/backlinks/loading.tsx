import { Skeleton } from "@/components/ui/skeleton";

export default function BacklinksLoading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5" aria-busy="true" aria-label="Loading backlinks">
      {/* page header */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* domain search bar */}
      <Skeleton className="h-12 rounded-lg" />

      {/* stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>

      {/* mentions table */}
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
