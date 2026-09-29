import { Skeleton } from "@/components/ui/skeleton";

export default function AuditHistoryLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-5" aria-busy="true" aria-label="Loading audit history">
      {/* heading */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* tabs */}
      <Skeleton className="h-10 w-64 rounded-lg" />

      {/* history rows */}
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
