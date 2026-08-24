"use client";

import {
  Download,
  Loader2,
  Plug,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { HealthIcon, healthBadge } from "@/components/setup/health-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SetupSnapshot, StepHealth } from "@/lib/setup/state";
import type { ConnectionStatus } from "@/lib/wordpress/sync";
import { cn } from "@/lib/utils";

export type WpStepId =
  | "install"
  | "activate"
  | "connect"
  | "verify"
  | "complete";

type WpStep = {
  id: WpStepId;
  title: string;
  body: string;
};

const STEPS: WpStep[] = [
  {
    id: "install",
    title: "Install WordPress Connector",
    body: "Download the Snaily SEO plugin ZIP and upload it in WordPress → Plugins → Add New → Upload Plugin.",
  },
  {
    id: "activate",
    title: "Activate Plugin",
    body: "After the upload finishes, click Activate. Then open Settings → Snaily SEO.",
  },
  {
    id: "connect",
    title: "Connect WordPress Site",
    body: "Copy the secret token from Settings → Snaily SEO and paste it here. We never store your WordPress password.",
  },
  {
    id: "verify",
    title: "Verify Connection",
    body: "We ping the plugin to confirm it is installed, activated, and answering.",
  },
  {
    id: "complete",
    title: "Complete Setup",
    body: "Drafts can be sent to WordPress, and the content library can sync posts.",
  },
];

function statusOf(
  id: WpStepId,
  health: StepHealth,
  downloaded: boolean,
  activated: boolean,
): StepHealth | "pending" {
  if (health === "connected") return "connected";
  if (id === "install") return downloaded ? "connected" : "pending";
  if (id === "activate") return activated ? "connected" : "pending";
  if (id === "connect") {
    return health === "connection_lost" ? "connection_lost" : "pending";
  }
  if (id === "verify") {
    return health === "connection_lost" ? "connection_lost" : "pending";
  }
  return health === "connection_lost" ? "connection_lost" : "pending";
}

function StatusIcon({ health }: { health: StepHealth | "pending" }) {
  return <HealthIcon health={health} />;
}

function badge(health: StepHealth | "pending"): { label: string; className: string } {
  return healthBadge(health);
}

/**
 * Guided WordPress connector flow.
 *
 * Used by first-run onboarding and by Finish Setup from anywhere else.
 * Connecting still goes through `/api/wordpress/connect` — this is UX only.
 */
export function WordpressSetupPanel({
  projectId,
  snapshot,
  onSnapshot,
}: {
  projectId: string;
  snapshot: SetupSnapshot;
  onSnapshot: (next: SetupSnapshot) => void;
}) {
  const health = snapshot.wordpress.health;
  const lost = health === "connection_lost";
  const connected = health === "connected";

  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"connect" | "verify" | null>(null);
  const [downloaded, setDownloaded] = useState(connected);
  const [activated, setActivated] = useState(connected);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);

  async function connect() {
    if (token.trim() === "") return;
    setBusy("connect");
    setVerifyNote(null);
    try {
      const res = await fetch("/api/wordpress/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, token: token.trim() }),
      });
      const data = (await res.json()) as {
        status?: ConnectionStatus;
        error?: string;
      };
      if (!res.ok) {
        toast.error("Could not connect. Check the token and that the plugin is active.");
        console.error("[wordpress connect]", data.error);
        return;
      }
      setToken("");
      toast.success("WordPress connected");
      const snap = await refresh();
      if (snap) onSnapshot(snap);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setBusy("verify");
    setVerifyNote(null);
    try {
      const res = await fetch("/api/wordpress/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reason?: string;
        message?: string;
        health?: StepHealth;
        snapshot?: SetupSnapshot;
        error?: string;
      };

      if (!res.ok) {
        toast.error(data.error ?? "Could not reach the verification endpoint");
        return;
      }
      if (data.snapshot) onSnapshot(data.snapshot);

      /*
       * The server always names why. Showing its message instead of a generic
       * "could not verify" is the whole point — reinstalling the plugin fixes
       * PLUGIN_NOT_ACTIVE and does nothing at all for DOMAIN_MISMATCH.
       */
      const note = data.message ?? "Could not verify the connection.";
      setVerifyNote(note);

      if (data.ok === true) {
        toast.success("Connection verified");
      } else {
        toast.error(note);
      }
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(null);
    }
  }

  async function refresh(): Promise<SetupSnapshot | null> {
    try {
      const res = await fetch(`/api/setup?projectId=${projectId}`);
      const data = (await res.json()) as { snapshot?: SetupSnapshot };
      return data.snapshot ?? null;
    } catch {
      return null;
    }
  }

  return (
    <ol className="space-y-3">
      {STEPS.map((step, i) => {
        const st = statusOf(step.id, health, downloaded, activated);
        const tone = badge(st);
        return (
          <li
            key={step.id}
            className={cn(
              "rounded-xl border bg-card p-3 sm:p-4",
              st === "connection_lost"
                ? "border-destructive/30"
                : st === "connected"
                  ? "border-success/25"
                  : "border-border",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  st === "connected" && "border-success/40 bg-success/10",
                  st === "connection_lost" && "border-destructive/40 bg-destructive/10",
                  st === "pending" && "border-border text-muted-foreground",
                )}
              >
                {st === "connected" || st === "connection_lost" ? (
                  <StatusIcon health={st} />
                ) : (
                  i + 1
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{step.title}</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      tone.className,
                    )}
                  >
                    {tone.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                  {step.body}
                </p>

                {/*
                  The download stays available after connecting.

                  It used to be hidden once `connected` was true, which made the
                  "connector is out of date" error a dead end: it tells you to
                  download the latest plugin from Finish Setup, and Finish Setup
                  had no download button because the site was still connected.
                  Updating is exactly the case where you are connected and need
                  the file again.
                */}
                {step.id === "install" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a
                        href="/api/wordpress/plugin"
                        download
                        onClick={() => {
                          setDownloaded(true);
                        }}
                      >
                        <Download />
                        {connected
                          ? "Download latest plugin (.zip)"
                          : "Download plugin (.zip)"}
                      </a>
                    </Button>
                    {connected && (
                      <span className="text-[11px] text-muted-foreground">
                        Deactivate and delete the old plugin first, then upload
                        this one — WordPress will not overwrite it otherwise.
                      </span>
                    )}
                  </div>
                )}

                {step.id === "activate" && !connected && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => {
                      setActivated(true);
                    }}
                  >
                    I have activated it
                  </Button>
                )}

                {step.id === "connect" && !connected && (
                  <div className="mt-3 space-y-1.5">
                    {lost && (
                      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-muted-foreground">
                        Your WordPress connector is no longer active. Install
                        and activate the plugin again, then paste a fresh token.
                      </p>
                    )}
                    <Label htmlFor="wp-setup-token">Connector token</Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="wp-setup-token"
                        value={token}
                        onChange={(e) => {
                          setToken(e.target.value);
                        }}
                        placeholder="Paste from WordPress → Settings → Snaily SEO"
                        className="font-mono text-xs"
                      />
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={busy !== null || token.trim() === ""}
                        onClick={() => void connect()}
                      >
                        {busy === "connect" ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Plug />
                        )}
                        {lost ? "Reconnect" : "Connect"}
                      </Button>
                    </div>
                  </div>
                )}

                {step.id === "verify" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void verify()}
                    >
                      {busy === "verify" ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <RefreshCw />
                      )}
                      Verify now
                    </Button>
                    {verifyNote !== null && (
                      <p className="text-xs text-muted-foreground">{verifyNote}</p>
                    )}
                  </div>
                )}

                {step.id === "complete" && connected && (
                  <p className="mt-2 text-xs text-success">
                    Connected to {snapshot.wordpress.siteName || snapshot.wordpress.siteUrl}.
                    Send to WordPress and content sync are available.
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
