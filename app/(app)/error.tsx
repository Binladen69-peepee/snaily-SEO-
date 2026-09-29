"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error.message || "Client error boundary",
        digest: error.digest,
        route: typeof window !== "undefined" ? window.location.pathname : "client",
      }),
    }).catch(() => {
      /* reporting must never mask the boundary */
    });
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center sm:py-20"
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="size-5 text-destructive" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="font-medium">Something went wrong</p>
        <p className="text-sm text-muted-foreground">
          {error.message || "This page could not be loaded. Please try again."}
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">Ref {error.digest}</p>
        ) : null}
      </div>
      <Button onClick={reset}>
        <RotateCw />
        Try again
      </Button>
    </div>
  );
}
