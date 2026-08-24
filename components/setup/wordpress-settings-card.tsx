"use client";

import { Plug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConnectorPanel } from "@/components/setup/connector-panel";
import { HealthIcon, healthBadge } from "@/components/setup/health-badge";
import { useSetup } from "@/components/setup/setup-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SetupSnapshot } from "@/lib/setup/state";
import { cn } from "@/lib/utils";

export function WordpressSettingsCard({
  projectId,
  snapshot: initial,
}: {
  projectId: string;
  snapshot: SetupSnapshot | null;
}) {
  const router = useRouter();
  const { snapshot: ctx, openSetup, setSnapshot } = useSetup();
  const snapshot =
    ctx?.projectId === projectId ? ctx : initial;
  const [muted, setMuted] = useState(snapshot?.reminderMuted ?? false);
  const [busy, setBusy] = useState(false);

  if (snapshot === null) return null;

  const health = snapshot.wordpress.health;
  const tone = healthBadge(health);
  const lost = health === "connection_lost";

  async function toggleMute(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, muted: next }),
      });
      if (!res.ok) {
        toast.error("Could not update reminder settings");
        return;
      }
      setMuted(next);
      if (ctx?.projectId === projectId) {
        setSnapshot({ ...ctx, reminderMuted: next });
      }
      toast.success(
        next
          ? "WordPress setup reminders hidden"
          : "WordPress setup reminders are on again",
      );
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">WordPress connector</CardTitle>
            <CardDescription>
              Optional. Send to WordPress and post sync need this plugin.
              Everything else in Snaily SEO works without it.
            </CardDescription>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
              tone.className,
            )}
          >
            <HealthIcon health={health} className="size-3.5" />
            {tone.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {health === "connected" ? (
          <p className="text-sm text-muted-foreground">
            Connected to {snapshot.wordpress.siteName || snapshot.wordpress.siteUrl}.
          </p>
        ) : lost ? (
          <p className="text-sm text-muted-foreground">
            Your WordPress connector is no longer active. Reinstall the plugin
            and reconnect to send drafts again.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not connected. Drafter cannot send drafts, and the content library
            cannot sync posts, until the connector is installed.
          </p>
        )}

        {health !== "connected" && (
          <Button
            size="sm"
            onClick={() => {
              if (ctx?.projectId === projectId) {
                openSetup();
                return;
              }
              router.push(`/projects/${projectId}/setup`);
            }}
          >
            <Plug />
            {lost ? "Reconnect" : "Finish Setup"}
          </Button>
        )}

        {/*
          Versions and the archive itself. The same component renders on
          Integrations, so both screens report one version and hand out one zip.
        */}
        <ConnectorPanel projectId={projectId} />

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={muted}
            disabled={busy}
            onChange={(e) => {
              void toggleMute(e.target.checked);
            }}
          />
          <span>
            <span className="font-medium">Hide WordPress setup reminders</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Stops the header chip and floating card. Send to WordPress still
              asks you to finish setup. This is the only way to dismiss
              reminders indefinitely.
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
