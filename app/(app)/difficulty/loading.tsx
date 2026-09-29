import { Skeleton } from "@/components/ui/skeleton";

export default function DifficultyLoading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5" aria-busy="true" aria-label="Loading difficulty">
      {/* page header */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* search form */}
      <Skeleton className="h-12 rounded-lg" />

      {/* score + stats area */}
      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <Skeleton className="h-40 w-64 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>

      {/* SERP analysis */}
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
