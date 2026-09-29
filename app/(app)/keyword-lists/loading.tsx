import { Skeleton } from "@/components/ui/skeleton";

export default function KeywordListsLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-5" aria-busy="true" aria-label="Loading keyword lists">
      {/* page header */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>

      {/* list cards */}
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
