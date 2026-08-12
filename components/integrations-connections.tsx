"use client";

import {
  AlertTriangle,
  CircleCheck,
  Link2Off,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { GoogleProperties, type ProjectGoogleLinks } from "@/components/google-properties";
import { Button } from "@/components/ui/button";
import { DEPENDENTS } from "@/lib/integrations-impact";
import { cn } from "@/lib/utils";

export type ConnectedProject = ProjectGoogleLinks & {
  id: string;
  name: string;
  url: string;
  gscSyncedAt: string | null;
  ga4SyncedAt: string | null;
  googleSyncError: string | null;
};

export type GoogleConnection = {
  email: string;
  hasSearchConsole: boolean;
  hasAnalytics: boolean;
  lastError: string | null;
} | null;

function timeAgo(iso: string | null): string {
  if (iso === null) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${String(mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return `${String(Math.round(hours / 24))} days ago`;
}

/**
 * Everything this deployment is connected to, and the controls to change it.
 *
 * Connections used to be split — status here, the actual switches in project
 * settings — which meant answering "what is this linked to and is it working"
 * took three pages. Both live here now, per project, because that is the
 * question an owner actually asks.
 */
export function IntegrationsConnections({
  account,
  projects,
}: {
  account: GoogleConnection;
  projects: ConnectedProject[];
}) {
  const [connection, setConnection] = useState(account);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [rows, setRows] = useState(projects);

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect Google?\n\nSearch Console and Analytics stop syncing straight away. Each project keeps the property it is linked to, and data already synced stays, so reconnecting the same account restores everything.",
      )
    ) {
      return;
    }

    setDisconnecting(true);
    try {
      const res = await fetch("/api/google/account", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not disconnect");
        return;
      }
      setConnection(null);
      toast.success("Google disconnected — syncing has stopped");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setDisconnecting(false);
    }
  }

  async function syncNow(projectId: string) {
    setSyncing(projectId);
    try {
      const res = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Sync failed");
        setRows((prev) =>
          prev.map((p) =>
            p.id === projectId ? { ...p, googleSyncError: data.error ?? "Sync failed" } : p,
          ),
        );
        return;
      }
      const now = new Date().toISOString();
      setRows((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, gscSyncedAt: now, ga4SyncedAt: now, googleSyncError: null }
            : p,
        ),
      );
      toast.success("Synced");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSyncing(null);
    }
  }

  const powers = DEPENDENTS.GOOGLE_TOKENS ?? [];

  return (
    <details className="group rounded-xl border border-border bg-card p-4 shadow-sm">
      {/*
        Collapsed by default so the page keeps its landscape shape and does not
        scroll. The summary carries the answer most of the time; opening it is
        one click and everything is still on this page.
      */}
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Connections</h2>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                connection === null
                  ? "bg-warning/15 text-warning ring-warning/25"
                  : connection.lastError
                    ? "bg-destructive/10 text-destructive ring-destructive/25"
                    : "bg-success/12 text-success ring-success/20",
              )}
            >
              {connection === null
                ? "No Google account"
                : connection.lastError
                  ? `Failing — ${connection.email}`
                  : connection.email}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {rows.length === 0
                ? "no projects"
                : `${String(rows.filter((p) => p.gscSiteUrl !== null).length)} of ${String(rows.length)} projects linked`}
            </span>
          </div>
          <span className="text-[11px] text-primary group-open:hidden">Manage</span>
          <span className="hidden text-[11px] text-primary group-open:inline">Hide</span>
        </div>
      </summary>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Accounts and properties this deployment is linked to. Change any of it
        here — there is nowhere else you need to go.
      </p>

      {/* ---------------- the Google account ---------------- */}
      <div className="mt-3 rounded border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold">Google account</h3>
            {connection === null ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Not connected. Search Console and Analytics data cannot sync.
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {connection.email}
              </p>
            )}
          </div>

          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
              connection === null
                ? "bg-warning/15 text-warning"
                : connection.lastError
                  ? "bg-destructive/10 text-destructive"
                  : "bg-success/12 text-success",
            )}
          >
            {connection === null ? (
              <AlertTriangle className="size-3" aria-hidden />
            ) : connection.lastError ? (
              <AlertTriangle className="size-3" aria-hidden />
            ) : (
              <CircleCheck className="size-3" aria-hidden />
            )}
            {connection === null
              ? "Not connected"
              : connection.lastError
                ? "Failing"
                : "Connected"}
          </span>
        </div>

        {/*
          Deliberately terse: the status reason, the granted scopes and what
          this connection powers are all on the "Connected Google account" card
          in the rail above. Repeating them here only made the page longer.
        */}
        {connection !== null && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Search Console {connection.hasSearchConsole ? "granted" : "not granted"}
            {" · "}
            Analytics {connection.hasAnalytics ? "granted" : "not granted"}
            {" · "}
            powers {powers.length} features — see the card above
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-8" asChild>
            <a href="/api/auth/google?next=/integrations">
              <RefreshCw />
              {connection === null ? "Connect Google" : "Reconnect"}
            </a>
          </Button>
          {connection !== null && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={disconnecting}
              onClick={() => void disconnect()}
            >
              {disconnecting ? <Loader2 className="animate-spin" /> : <Link2Off />}
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {/* ---------------- per-project links ---------------- */}
      <h3 className="mt-4 text-xs font-semibold">
        Linked properties, per project
      </h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        One Search Console site and one Analytics property each. Changing a
        selection here is a choice, not a new consent — it never re-prompts
        Google.
      </p>

      {rows.length === 0 ? (
        <p className="mt-2 rounded border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
          No projects yet. Add one and it will appear here.
        </p>
      ) : (
        // A landscape rail, matching the services above: projects run across
        // rather than stacking, so adding a project does not lengthen the page.
        <div
          className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
          role="region"
          aria-label="Linked properties per project"
        >
          {rows.map((p) => (
            <div
              key={p.id}
              className="w-[85vw] max-w-96 shrink-0 snap-start rounded border border-border p-3 sm:w-96"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{p.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{p.url}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    synced {timeAgo(p.gscSyncedAt)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={syncing !== null || connection === null}
                    onClick={() => void syncNow(p.id)}
                    title={
                      connection === null
                        ? "Connect Google first"
                        : "Fetch the latest Search Console and Analytics data"
                    }
                  >
                    {syncing === p.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Sync now
                  </Button>
                </div>
              </div>

              {p.googleSyncError !== null && p.googleSyncError !== "" && (
                <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-muted-foreground">
                  Last sync failed: {p.googleSyncError}
                </p>
              )}

              <div className="mt-2">
                <GoogleProperties
                  projectId={p.id}
                  googleEmail={connection?.email ?? null}
                  initial={{
                    gscSiteUrl: p.gscSiteUrl,
                    gscSiteName: p.gscSiteName,
                    ga4PropertyId: p.ga4PropertyId,
                    ga4PropertyName: p.ga4PropertyName,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
