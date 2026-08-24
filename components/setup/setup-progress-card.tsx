"use client";

import { Check, Plug, XCircle } from "lucide-react";

import { useSetup } from "@/components/setup/setup-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SetupProgressCard() {
  const { snapshot, openSetup, snooze } = useSetup();
  if (snapshot === null) return null;

  const lost = snapshot.wordpress.health === "connection_lost";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Project setup</CardTitle>
          <Badge variant={snapshot.remaining === 0 ? "success" : "warning"}>
            {snapshot.percent}% complete
          </Badge>
        </div>
        <CardDescription>
          {snapshot.remaining === 0
            ? "Website, Google and WordPress are connected."
            : lost
              ? "Your WordPress connector is no longer active. Reinstall the plugin to send drafts and sync posts again."
              : "WordPress is optional. Without it, Send to WordPress and post sync are unavailable — keyword research, audits and rank tracking still work."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${String(snapshot.percent)}%` }}
          />
        </div>
        <ul className="space-y-2">
          {snapshot.steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              {s.health === "connection_lost" ? (
                <XCircle className="size-4 shrink-0 text-destructive" />
              ) : s.done ? (
                <Check className="size-4 shrink-0 text-success" />
              ) : (
                <span className="size-4 shrink-0 rounded-full border border-border" />
              )}
              <span className={s.done ? "text-muted-foreground" : "font-medium"}>
                {s.label}
                {s.done ? " connected" : s.health === "connection_lost" ? " — connection lost" : " not connected"}
              </span>
              <span
                className={cn(
                  "ml-auto hidden truncate text-xs sm:inline",
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
        {snapshot.needsWordpressAttention && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openSetup()} size="sm">
              <Plug />
              {lost ? "Reconnect" : "Finish Setup"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void snooze();
              }}
            >
              Remind me later
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
