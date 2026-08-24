"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobView } from "@/lib/jobs/types";

/**
 * How often the browser asks how the job is going.
 *
 * Also the recovery heartbeat: the status endpoint restarts a job whose worker
 * has died, so polling is not merely reading — it is what makes a dropped
 * chain self-heal while anybody has the page open. Two seconds is slow enough
 * to be free and fast enough that a finished stage appears immediately.
 */
const POLL_MS = 2_000;

export function useDraftJob(articleId: string, onComplete: () => void) {
  const [job, setJob] = useState<JobView | null>(null);
  const [starting, setStarting] = useState(false);
  const completed = useRef(false);

  /** Picks up a job that was already running when this page loaded. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/articles/${articleId}/draft-job`);
        if (!res.ok) return;
        const data = (await res.json()) as { job: JobView | null };
        if (!cancelled && data.job !== null && data.job.status !== "completed") {
          setJob(data.job);
        }
      } catch {
        /* Nothing to resume is the normal case. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  const live =
    job !== null &&
    (job.status === "queued" ||
      job.status === "running" ||
      job.status === "retrying" ||
      job.status === "paused");

  useEffect(() => {
    if (job === null || !live) return;

    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/draft-jobs/${job.id}`);
          if (!res.ok) return;
          const data = (await res.json()) as { job: JobView };
          setJob(data.job);

          if (data.job.status === "completed" && !completed.current) {
            completed.current = true;
            onComplete();
          }
        } catch {
          /* A dropped poll is retried on the next tick. */
        }
      })();
    }, POLL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [job, live, onComplete]);

  const start = useCallback(async () => {
    setStarting(true);
    completed.current = false;
    try {
      const res = await fetch(`/api/articles/${articleId}/draft-job`, {
        method: "POST",
      });
      const data = (await res.json()) as { job?: JobView; error?: string };
      if (!res.ok || data.job === undefined) {
        toast.error(data.error ?? "Could not start drafting.");
        return;
      }
      setJob(data.job);
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setStarting(false);
    }
  }, [articleId]);

  const dismiss = useCallback(() => {
    setJob(null);
  }, []);

  return { job, setJob, live, starting, start, dismiss };
}

function StageIcon({ status }: { status: JobView["stages"][number]["status"] }) {
  if (status === "completed" || status === "skipped") {
    return <Check className="size-4 shrink-0 text-success" aria-hidden />;
  }
  if (status === "running") {
    return <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />;
  }
  if (status === "failed") {
    return <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />;
  }
  /*
   * `block` is load-bearing. A bare span is inline, so width and height are
   * ignored and the "not started yet" marker rendered as a one-pixel vertical
   * line beside every pending step - which read as a list rule rather than as
   * an empty circle waiting to be ticked.
   */
  return (
    <span
      className="block size-4 shrink-0 rounded-full border border-muted-foreground/40"
      aria-hidden
    />
  );
}

/**
 * The one thing the author watches after clicking Draft Article.
 *
 * Progress is the stage list, not a percentage. A fabricated bar creeping to
 * 90% and stopping is worse than no bar at all, and the job genuinely knows
 * which stage it is on — so that is what it shows. Nothing here
 * reveals prompts, tokens or model names; those live in the diagnostics
 * endpoint for whoever is paying the bill.
 */
export function DraftProgress({
  job,
  onJobChange,
  onDismiss,
}: {
  job: JobView;
  onJobChange: (job: JobView) => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState<"cancel" | "retry" | null>(null);
  const [showAll, setShowAll] = useState(false);

  const failed = job.status === "failed";
  const cancelled = job.status === "cancelled";
  const done = job.status === "completed";

  async function cancel() {
    setBusy("cancel");
    try {
      const res = await fetch(`/api/draft-jobs/${job.id}/cancel`, { method: "POST" });
      const data = (await res.json()) as { message?: string };
      toast.message(data.message ?? "Stopping.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    try {
      const res = await fetch(`/api/draft-jobs/${job.id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: job.failedStage ?? undefined }),
      });
      const data = (await res.json()) as { retrying?: string; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not retry.");
        return;
      }
      onJobChange({ ...job, status: "queued", errorMessage: null, errorCode: null });
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const running = job.stages.find((s) => s.status === "running");
  const failedStage = job.stages.find((s) => s.status === "failed");

  /*
   * Fifteen rows is a lot to watch. The default view is the step in flight
   * with a little context around it, which is the part that changes; the whole
   * list is one click away for anyone who wants it.
   */
  const focusIndex = Math.max(
    0,
    job.stages.findIndex((s) => s.status === "running" || s.status === "failed"),
  );
  const visible = showAll
    ? job.stages
    : job.stages.slice(Math.max(0, focusIndex - 2), focusIndex + 4);

  return (
    <div className="mx-auto w-full max-w-xl rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold sm:text-lg">
            {done
              ? "Your article is ready"
              : failed
                ? "Drafting paused"
                : cancelled
                  ? "Drafting stopped"
                  : "Writing your article…"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {failed || cancelled
              ? "Everything written so far has been kept."
              : `${String(job.done)} of ${String(job.total)} steps complete${
                  running?.detail ? ` · ${running.detail}` : ""
                }`}
          </p>
        </div>

        {(done || failed || cancelled) && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div
        className="mt-4 h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={job.done}
        aria-valuemin={0}
        aria-valuemax={job.total}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            failed ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${String(Math.round((job.done / job.total) * 100))}%` }}
        />
      </div>

      <ul className="mt-4 space-y-2">
        {visible.map((stage) => (
          <li
            key={stage.name}
            className={cn(
              "flex items-start gap-2.5 text-sm",
              stage.status === "pending" && "text-muted-foreground/60",
              stage.status === "running" && "font-medium text-foreground",
              stage.status === "failed" && "text-destructive",
            )}
          >
            <span className="mt-0.5">
              <StageIcon status={stage.status} />
            </span>
            <span className="min-w-0">
              {stage.label}
              {stage.status === "running" && stage.detail !== "" && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {stage.detail}
                </span>
              )}
              {stage.status === "skipped" && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  not needed
                </span>
              )}
              {stage.status === "failed" && stage.errorMessage !== null && (
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {stage.errorMessage}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {job.stages.length > visible.length && (
        <button
          type="button"
          onClick={() => {
            setShowAll((v) => !v);
          }}
          className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {showAll ? "Show less" : `Show all ${String(job.total)} steps`}
        </button>
      )}

      {failed && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
          We couldn&apos;t finish {failedStage?.label.toLowerCase() ?? "a step"}.
          {job.errorMessage !== null && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {job.errorMessage}
            </span>
          )}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(failed || cancelled) && (
          <Button size="sm" onClick={() => void retry()} disabled={busy !== null}>
            {busy === "retry" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RotateCw className="size-3.5" aria-hidden />
            )}
            {failed ? "Retry this step" : "Pick up where it stopped"}
          </Button>
        )}

        {!done && !failed && !cancelled && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void cancel()}
            disabled={busy !== null}
          >
            {busy === "cancel" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            Stop
          </Button>
        )}

        {(done || cancelled) && (
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Open the editor
          </Button>
        )}
      </div>

      {!done && !failed && !cancelled && (
        <p className="mt-4 text-xs text-muted-foreground">
          You can close this tab. Drafting carries on and picks up where it left
          off when you come back.
        </p>
      )}
    </div>
  );
}
