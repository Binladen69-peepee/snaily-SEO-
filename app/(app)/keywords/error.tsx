"use client";

import { AlertCircle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function KeywordsError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="size-5 text-destructive" />
      </div>
      <div>
        <p className="font-medium">Something went wrong</p>
        <p className="text-sm text-muted-foreground">
          {error.message || "Keyword research is temporarily unavailable."}
        </p>
      </div>
      <Button onClick={reset}>
        <RotateCw />
        Try again
      </Button>
    </div>
  );
}
