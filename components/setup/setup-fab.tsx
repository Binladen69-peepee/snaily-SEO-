"use client";

import { Plug } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import type { SetupSnapshot } from "@/lib/setup/state";

export function SetupFab({
  snapshot,
  onFinish,
  onSnooze,
}: {
  snapshot: SetupSnapshot;
  onFinish: () => void;
  onSnooze: () => void;
}) {
  const lost = snapshot.wordpress.health === "connection_lost";

  useEffect(() => {
    document.body.classList.add("has-setup-fab");
    return () => {
      document.body.classList.remove("has-setup-fab");
    };
  }, []);

  return (
    <aside
      className="pointer-events-auto fixed bottom-4 left-4 right-4 z-40 sm:left-auto sm:right-4 sm:w-[20rem]"
      aria-label="WordPress setup"
    >
      <div className="rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Plug className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {lost ? "Connection lost" : "WordPress setup incomplete"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {lost
                ? "Your WordPress connector is no longer active. Send to WordPress and post sync are unavailable until you reconnect."
                : "Install the connector to send drafts and sync posts. Keyword research, audits and rank tracking still work."}
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {String(snapshot.completed)} of {String(snapshot.total)} steps
              complete
            </p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${String(snapshot.percent)}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={onFinish}>
                {lost ? "Reconnect" : "Finish Setup"}
              </Button>
              <Button size="sm" variant="ghost" onClick={onSnooze}>
                Remind me later
              </Button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
