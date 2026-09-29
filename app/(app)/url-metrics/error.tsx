"use client";

import { AlertCircle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function UrlMetricsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center sm:py-20">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="size-5 text-destructive" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="font-medium">URL metrics failed</p>
        <p className="text-sm text-muted-foreground">
          {error.message || "Could not read metrics for this URL. Please try again."}
        </p>
      </div>
      <Button onClick={reset}>
        <RotateCw />
        Try again
      </Button>
    </div>
  );
}
