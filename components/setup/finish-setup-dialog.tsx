"use client";

import { Check, XCircle } from "lucide-react";

import { WordpressSetupPanel } from "@/components/setup/wordpress-setup-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SetupSnapshot, StepHealth } from "@/lib/setup/state";
import { cn } from "@/lib/utils";

function StepMark({ health, done }: { health: StepHealth; done: boolean }) {
  if (health === "connection_lost") {
    return <XCircle className="size-4 shrink-0 text-destructive" aria-hidden />;
  }
  if (done) {
    return <Check className="size-4 shrink-0 text-success" aria-hidden />;
  }
  return (
    <span
      className="size-4 shrink-0 rounded-full border border-border"
      aria-hidden
    />
  );
}

export function FinishSetupDialog({
  open,
  onOpenChange,
  snapshot,
  onSnapshot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: SetupSnapshot;
  onSnapshot: (next: SetupSnapshot) => void;
}) {
  const lost = snapshot.wordpress.health === "connection_lost";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {lost ? "Reconnect WordPress" : "Finish Setup"}
          </DialogTitle>
          <DialogDescription>
            {lost
              ? "Your WordPress connector is no longer active. Reinstall the plugin and verify the connection."
              : "Connect the Snaily SEO WordPress plugin to send drafts and sync posts. Everything else in the app keeps working without it."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Project setup</p>
            <p className="tabular text-xs text-muted-foreground">
              {snapshot.percent}% complete
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${String(snapshot.percent)}%` }}
            />
          </div>
          <ul className="mt-3 space-y-1.5">
            {snapshot.steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <StepMark health={s.health} done={s.done} />
                <span className={s.done ? "text-muted-foreground" : "font-medium"}>
                  {s.label}
                </span>
                <span
                  className={cn(
                    "ml-auto truncate text-xs",
                    s.health === "connection_lost"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {s.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <WordpressSetupPanel
          projectId={snapshot.projectId}
          snapshot={snapshot}
          onSnapshot={onSnapshot}
        />

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {snapshot.wordpress.health === "connected" ? "Done" : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
