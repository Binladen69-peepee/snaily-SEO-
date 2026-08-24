import { Check, Circle, TriangleAlert, XCircle } from "lucide-react";

import type { StepHealth } from "@/lib/setup/state";
import { cn } from "@/lib/utils";

export function healthBadge(health: StepHealth | "pending"): {
  label: string;
  className: string;
} {
  if (health === "connected") {
    return { label: "Connected", className: "bg-success/12 text-success" };
  }
  if (health === "connection_lost") {
    return { label: "Connection lost", className: "bg-destructive/12 text-destructive" };
  }
  if (health === "not_configured") {
    return { label: "Not configured", className: "bg-muted text-muted-foreground" };
  }
  return { label: "Setup incomplete", className: "bg-warning/15 text-warning" };
}

export function HealthIcon({
  health,
  className,
}: {
  health: StepHealth | "pending";
  className?: string;
}) {
  const cls = cn("size-4 shrink-0", className);
  if (health === "connected") {
    return <Check className={cn(cls, "text-success")} aria-hidden />;
  }
  if (health === "connection_lost") {
    return <XCircle className={cn(cls, "text-destructive")} aria-hidden />;
  }
  if (health === "pending") {
    return <TriangleAlert className={cn(cls, "text-warning")} aria-hidden />;
  }
  return <Circle className={cn(cls, "size-3.5 text-muted-foreground")} aria-hidden />;
}
