import { Skeleton } from "@/components/ui/skeleton";

export default function OnPageLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-5" aria-busy="true" aria-label="Loading on-page SEO">
      {/* heading */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* URL input area */}
      <Skeleton className="h-12 rounded-lg" />

      {/* results section */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>

      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
