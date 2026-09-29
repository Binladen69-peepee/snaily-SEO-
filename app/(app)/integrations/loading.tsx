import { Skeleton } from "@/components/ui/skeleton";

export default function IntegrationsLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-5" aria-busy="true" aria-label="Loading integrations">
      {/* heading row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* connections section */}
      <Skeleton className="h-32 rounded-xl" />

      {/* connector section */}
      <Skeleton className="h-28 rounded-xl" />

      {/* API keys section */}
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
