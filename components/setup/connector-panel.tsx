"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Download,
  Loader2,
  Plug,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  CONNECTOR_DOWNLOAD_PATH,
  connectorStatus,
  type ConnectorState,
} from "@/lib/wordpress/connector-status";
import { cn } from "@/lib/utils";

/**
 * The connector's version and health, with the three things you can do about it.
 *
 * Mounted in Project Settings and in Integrations. Both render this same
 * component against the same endpoint and the same download route, so the two
 * screens cannot drift into reporting different versions or handing out
 * different archives — which is exactly what happened when the download was
 * described in one place and served from another.
 */

type Verify = {
  ok: boolean;
  reason: string;
  message: string;
  installed: string | null;
  expected: string;
  siteName?: string;
};

const TONE: Record<ConnectorState, { className: string; Icon: typeof CheckCircle2 }> = {
  "up-to-date": {
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    Icon: CheckCircle2,
  },
  "update-required": {
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    Icon: AlertTriangle,
  },
  "connection-lost": {
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    Icon: XCircle,
  },
  "not-installed": {
    className: "border-border bg-muted text-muted-foreground",
    Icon: Circle,
  },
};

export function ConnectorPanel({
  projectId,
  projectName,
  className,
}: {
  projectId: string;
  /** Shown when several projects are listed together. */
  projectName?: string;
  className?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<Verify | null>(null);
  const [checking, setChecking] = useState(true);

  const verify = useCallback(
    async (announce: boolean) => {
      setChecking(true);
      try {
        const res = await fetch("/api/wordpress/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) {
          if (announce) toast.error("Could not check the connector.");
          return;
        }
        const body = (await res.json()) as Verify;
        setData(body);
        if (announce) {
          if (body.ok) toast.success("The connector is answering.");
          else toast.error(body.message);
        }
      } catch {
        if (announce) toast.error("Could not reach the server.");
      } finally {
        setChecking(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void verify(false);
  }, [verify]);

  const status =
    data === null
      ? null
      : connectorStatus({
          reason: data.reason,
          installed: data.installed,
          latest: data.expected,
        });

  const tone = status === null ? TONE["not-installed"] : TONE[status.state];
  const Icon = tone.Icon;

  return (
    <div
      data-testid="connector-panel"
      className={cn("rounded-lg border border-border p-4", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Plug className="size-4 text-muted-foreground" aria-hidden />
            WordPress Connector
            {projectName !== undefined && (
              <span className="truncate text-muted-foreground">· {projectName}</span>
            )}
          </h3>
          {data?.message !== undefined && !checking && (
            <p className="mt-1 text-xs text-muted-foreground">{data.message}</p>
          )}
        </div>

        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
            tone.className,
          )}
        >
          {checking && data === null ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Icon className="size-3.5" aria-hidden />
          )}
          {checking && data === null ? "Checking…" : (status?.label ?? "Unknown")}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Installed version</dt>
          {/*
            "Not installed" only when that is what the state actually says.
            A site that is unreachable, or answering from the wrong domain, has
            a version we could not read — which is not the same thing, and
            printing the wrong one of the two sends people to the wrong screen.
          */}
          <dd className="mt-0.5 font-mono text-sm">
            {data === null
              ? "—"
              : data.installed !== null && data.installed !== ""
                ? data.installed
                : status?.state === "not-installed"
                  ? "Not installed"
                  : "Unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Latest version</dt>
          <dd className="mt-0.5 font-mono text-sm">{data?.expected ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Connection</dt>
          <dd className="mt-0.5 text-sm">
            {data === null ? "—" : data.ok ? (data.siteName ?? "Connected") : "Not answering"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {/*
          A plain link, not a fetch: the browser's own download handling is what
          names the file and puts it where the user expects it.
        */}
        <Button asChild size="sm" variant="outline">
          <a href={CONNECTOR_DOWNLOAD_PATH} download>
            <Download />
            Download latest connector
          </a>
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => {
            void verify(true);
          }}
        >
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Verify connection
        </Button>

        {status !== null && status.needsReconnect && (
          <Button
            size="sm"
            onClick={() => {
              router.push(`/projects/${projectId}/setup`);
            }}
          >
            <Plug />
            Reconnect
          </Button>
        )}
      </div>
    </div>
  );
}
