"use client";

import { Plug } from "lucide-react";

import { useSetup } from "@/components/setup/setup-provider";
import { cn } from "@/lib/utils";

/** Compact header chip — always visible when WordPress still needs attention. */
export function SetupIndicator() {
  const { snapshot, openSetup } = useSetup();

  if (
    snapshot === null ||
    !snapshot.needsWordpressAttention ||
    snapshot.reminderMuted
  ) {
    return null;
  }

  const lost = snapshot.wordpress.health === "connection_lost";

  return (
    <button
      type="button"
      onClick={() => {
        openSetup({ reason: lost ? "connection_lost" : "not_configured" });
      }}
      className={cn(
        "inline-flex max-w-[11rem] items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-xs font-medium transition-colors sm:max-w-none",
        lost
          ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15",
      )}
      title={
        lost
          ? "WordPress connection lost — finish setup"
          : `Setup incomplete · ${String(snapshot.remaining)} step${snapshot.remaining === 1 ? "" : "s"} remaining`
      }
    >
      <Plug className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {lost
          ? "Connection lost"
          : `Setup incomplete · ${String(snapshot.remaining)} left`}
      </span>
    </button>
  );
}
