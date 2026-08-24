"use client";

import {
  AlertTriangle,
  Check,
  CircleCheck,
  Download,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Guided connector update.
 *
 * Replaces a toast that told the user to "download the latest plugin from
 * Finish Setup" and then offered no way to do it. Everything needed happens
 * here: the download, the two manual WordPress steps, and a live check that
 * the new build is actually answering.
 *
 * The verify step matters more than it looks. WordPress refuses to overwrite an
 * existing plugin, so the commonest failure is uploading the new zip on top of
 * the old one and believing it worked. Checking the version the site reports is
 * the only way to know, and it is why the steps cannot simply be ticked off.
 */

type VerifyResult = {
  ok: boolean;
  /** Named failure from the verify route, e.g. OUTDATED_PLUGIN. */
  reason: string;
  installed: string | null;
  expected: string;
  message: string;
};

type StepState = { downloaded: boolean; removed: boolean; uploaded: boolean };

export function WpUpdateDialog({
  open,
  projectId,
  onOpenChange,
  onVerified,
}: {
  open: boolean;
  projectId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Called when the site confirms the new build — used to retry the send. */
  onVerified: () => void;
}) {
  const [steps, setSteps] = useState<StepState>({
    downloaded: false,
    removed: false,
    uploaded: false,
  });
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function verify() {
    if (projectId === null) return;
    setChecking(true);
    setResult(null);
    try {
      const res = await fetch("/api/wordpress/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as VerifyResult & { error?: string };
      setResult(
        res.ok
          ? data
          : {
              ok: false,
              reason: "SERVER_ERROR",
              installed: null,
              expected: "",
              message: data.error ?? "Could not check the connector.",
            },
      );
    } catch {
      setResult({
        ok: false,
        reason: "SERVER_ERROR",
        installed: null,
        expected: "",
        message: "Could not reach the server.",
      });
    } finally {
      setChecking(false);
    }
  }

  const allTicked = steps.downloaded && steps.removed && steps.uploaded;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Update the WordPress connector</DialogTitle>
          <DialogDescription>
            Your site is connected, but it&apos;s running an older connector that
            doesn&apos;t support sending this article. Three steps, about a
            minute. Your token stays the same.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-2">
          <Step
            n={1}
            done={steps.downloaded}
            title="Download the latest plugin"
            body="Saves snaily-seo-connector.zip to your computer."
          >
            <Button asChild size="sm" variant={steps.downloaded ? "outline" : "default"}>
              <a
                href="/api/wordpress/plugin"
                download
                onClick={() => {
                  setSteps((s) => ({ ...s, downloaded: true }));
                }}
              >
                <Download />
                {steps.downloaded ? "Download again" : "Download plugin (.zip)"}
              </a>
            </Button>
          </Step>

          <Step
            n={2}
            done={steps.removed}
            title="Delete the old plugin"
            body="In WordPress: Plugins → Snaily SEO Connector → Deactivate, then Delete. This step is not optional — WordPress will not overwrite an existing plugin, so uploading over the top silently keeps the old version."
          >
            <Toggle
              checked={steps.removed}
              onChange={(v) => {
                setSteps((s) => ({ ...s, removed: v }));
              }}
              label="I deactivated and deleted it"
            />
          </Step>

          <Step
            n={3}
            done={steps.uploaded}
            title="Upload and activate the new zip"
            body="Plugins → Add New → Upload Plugin → choose the zip → Install Now → Activate."
          >
            <Toggle
              checked={steps.uploaded}
              onChange={(v) => {
                setSteps((s) => ({ ...s, uploaded: v }));
              }}
              label="I uploaded and activated it"
            />
          </Step>
        </ol>

        {/* ---- verification ---- */}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Check it worked</p>
              <p className="text-xs text-muted-foreground">
                Asks your site which connector version is answering.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void verify()}
              disabled={checking || !allTicked || projectId === null}
            >
              {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Verify
            </Button>
          </div>

          {!allTicked && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Complete the three steps above first.
            </p>
          )}

          {result !== null && (
            <div
              className={cn(
                "mt-3 flex items-start gap-2 rounded-md border p-2.5 text-xs",
                result.ok
                  ? "border-success/40 bg-success/5 text-success"
                  : "border-warning/40 bg-warning/5 text-warning",
              )}
            >
              {result.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-medium">
                  {result.ok ? "Connector updated" : "Not updated yet"}
                </p>
                <p className="mt-0.5 text-muted-foreground">{result.message}</p>
                {result.installed !== null && (
                  <p className="mt-1 text-muted-foreground">
                    Installed {result.installed} · needs {result.expected}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => { onOpenChange(false); }}>
            Close
          </Button>
          <Button
            disabled={result?.ok !== true}
            onClick={() => {
              onOpenChange(false);
              onVerified();
            }}
          >
            <Send />
            Send to WordPress
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  n,
  done,
  title,
  body,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "rounded-lg border p-3 transition-colors",
        done ? "border-success/40 bg-success/5" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
            done
              ? "border-success/50 bg-success/15 text-success"
              : "border-border text-muted-foreground",
          )}
        >
          {done ? <Check className="size-3.5" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {body}
          </p>
          <div className="mt-2">{children}</div>
        </div>
      </div>
    </li>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}
