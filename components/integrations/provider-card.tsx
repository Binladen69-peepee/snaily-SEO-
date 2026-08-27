"use client";

/**
 * One card per provider, holding every field that provider needs.
 *
 * Previously each setting key got its own card, so DataForSEO was a login card
 * and a password card sitting next to each other with no indication they were
 * halves of one credential. Saving one and not the other left the store
 * authenticating as neither.
 *
 * The whole pair is submitted together and checked before anything is written,
 * so a bad replacement never destroys a working credential — the server keeps
 * the old values and says so.
 */

import { AlertTriangle, Check, CircleDashed, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import type { ProviderSpec, ProviderStatus } from "@/lib/integrations/providers";
import { STATUS_LABEL } from "@/lib/integrations/providers";
import type { SettingKey, SettingView } from "@/lib/settings";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<
  ProviderStatus,
  { icon: typeof Check; className: string }
> = {
  connected: {
    icon: Check,
    className: "border-success/30 bg-success/10 text-success",
  },
  auth_failed: {
    icon: XCircle,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  unavailable: {
    icon: AlertTriangle,
    className: "border-warning/35 bg-warning/10 text-warning",
  },
  not_configured: {
    icon: CircleDashed,
    className: "border-border bg-muted text-muted-foreground",
  },
  verifying: {
    icon: Loader2,
    className: "border-border bg-muted text-muted-foreground",
  },
};

function relative(iso: string | null): string {
  if (iso === null) return "";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${String(mins)} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${String(hrs)} hour${hrs === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProviderCard({
  provider,
  settings,
  logo,
  onSaved,
}: {
  provider: ProviderSpec;
  /** The masked views for this provider's keys. */
  settings: SettingView[];
  logo?: React.ReactNode;
  onSaved: (settings: SettingView[]) => void;
}) {
  const byKey = new Map(settings.map((s) => [s.key, s]));

  const [edits, setEdits] = useState<Partial<Record<SettingKey, string>>>({});
  const [busy, setBusy] = useState<"save" | "verify" | null>(null);
  const [verified, setVerified] = useState<{
    at: string | null;
    ok: boolean;
    message: string;
    detail?: string;
  } | null>(null);

  const configured = provider.keys.every(
    (k) => (byKey.get(k)?.source ?? "unset") !== "unset",
  );
  const dirty = Object.values(edits).some((v) => (v ?? "").trim() !== "");

  const status: ProviderStatus =
    busy === "verify"
      ? "verifying"
      : verified !== null
        ? verified.ok
          ? "connected"
          : "auth_failed"
        : configured
          ? "connected"
          : "not_configured";

  const tone = STATUS_TONE[status];
  const StatusIcon = tone.icon;

  async function submit(mode: "save" | "verify") {
    setBusy(mode);
    try {
      const res = await fetch("/api/settings/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          values: edits,
          verifyOnly: mode === "verify",
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        detail?: string;
        verifiedAt?: string | null;
        keptExisting?: boolean;
        settings?: SettingView[];
        error?: string;
      };

      if (res.status === 403) {
        toast.error("Only the owner can change integration keys.");
        return;
      }

      if (data.ok !== true) {
        setVerified({
          at: null,
          ok: false,
          message: data.message ?? data.error ?? "Verification failed.",
        });
        toast.error(
          data.keptExisting === true
            ? "Not saved — your previous credentials are still in place."
            : (data.message ?? "Verification failed."),
        );
        if (data.settings) onSaved(data.settings);
        return;
      }

      setVerified({
        at: data.verifiedAt ?? new Date().toISOString(),
        ok: true,
        message: data.message ?? "Connected.",
        detail: data.detail,
      });

      if (mode === "save") {
        setEdits({});
        if (data.settings) onSaved(data.settings);
        toast.success(`${provider.name} saved and verified.`);
      } else {
        toast.success(data.message ?? "Verified.");
      }
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-3">
          {logo !== undefined && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60">
              {logo}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-tight">
              {provider.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {provider.purpose}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn("shrink-0 gap-1.5", tone.className)}
          >
            <StatusIcon
              className={cn("size-3", status === "verifying" && "animate-spin")}
              aria-hidden
            />
            {STATUS_LABEL[status]}
          </Badge>
        </div>

        <div className="space-y-3">
          {provider.keys.map((key) => {
            const view = byKey.get(key);
            if (view === undefined) return null;
            const stored = view.source !== "unset";
            const Field = view.secret ? PasswordInput : Input;

            return (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`setting-${key}`} className="text-xs">
                  {view.label}
                </Label>
                <Field
                  id={`setting-${key}`}
                  value={edits[key] ?? ""}
                  placeholder={
                    stored
                      ? // The stored value is never sent here; this is a masked
                        // preview, so it belongs in the placeholder, not the value.
                        `${view.preview} — paste a new value to replace`
                      : view.placeholder
                  }
                  onChange={(e) => {
                    const next = e.target.value;
                    setEdits((c) => ({ ...c, [key]: next }));
                    setVerified(null);
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  {stored
                    ? `Set from ${view.source === "db" ? "this screen" : "the environment"}`
                    : "Not configured"}
                </p>
              </div>
            );
          })}
        </div>

        {verified !== null && (
          <Alert variant={verified.ok ? "success" : "destructive"}>
            <AlertDescription className="text-foreground">
              {verified.message}
              {verified.detail !== undefined && ` ${verified.detail}`}
              {!verified.ok && " Your previous credentials were kept."}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy !== null || !dirty}
            onClick={() => void submit("save")}
          >
            {busy === "save" && <Loader2 className="animate-spin" />}
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || (!configured && !dirty)}
            onClick={() => void submit("verify")}
          >
            {busy === "verify" && <Loader2 className="animate-spin" />}
            Verify
          </Button>

          {verified?.at != null && (
            <span className="text-[11px] text-muted-foreground">
              Verified {relative(verified.at)}
            </span>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {provider.console}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
