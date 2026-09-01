"use client";

import {
  AlertTriangle,
  Check,
  CircleCheck,
  CircleHelp,
  CircleX,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { initialsFor, SERVICES } from "@/lib/integrations-catalog";
import { DEPENDENTS } from "@/lib/integrations-impact";
import type { SettingView } from "@/lib/settings";
import type { HealthCheck, HealthLevel } from "@/lib/settings-health";
import { cn } from "@/lib/utils";

const LEVEL_LABEL: Record<HealthLevel, string> = {
  healthy: "Connected",
  warning: "At risk",
  failing: "Not working",
  unknown: "Unverified",
};

const LEVEL_TEXT: Record<HealthLevel, string> = {
  healthy: "text-success",
  warning: "text-warning",
  failing: "text-destructive",
  unknown: "text-muted-foreground",
};

const LEVEL_DOT: Record<HealthLevel, string> = {
  healthy: "bg-success",
  warning: "bg-warning",
  failing: "bg-destructive",
  unknown: "bg-muted-foreground/40",
};

const LEVEL_ICON: Record<HealthLevel, typeof CircleCheck> = {
  healthy: CircleCheck,
  warning: AlertTriangle,
  failing: CircleX,
  unknown: CircleHelp,
};

function ServiceIcon({ id, vendor }: { id: string; vendor: string }) {
  const [broken, setBroken] = useState(false);
  const src = SERVICES[id]?.favicon;

  if (broken || !src) {
    return (
      <span
        aria-hidden
        className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
      >
        {initialsFor(vendor)}
      </span>
    );
  }
  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-card ring-1 ring-inset ring-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={26}
        height={26}
        referrerPolicy="no-referrer"
        onError={() => { setBroken(true); }}
        className="size-6.5 object-contain"
      />
    </span>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function daysFrom(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** One labelled value inside the detail dialog. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-xs">{children}</dd>
    </div>
  );
}

export type RowModel = {
  /** SettingKey for editable rows, synthetic id for deployment-level ones. */
  id: string;
  name: string;
  description: string;
  category: string;
  health: HealthCheck;
  setting: SettingView | null;
};

/**
 * One integration, as a card in the grid.
 *
 * The card carries only what identifies the service and whether it is working;
 * everything operational — the key itself, provenance, usage, renewal, impact —
 * lives in a dialog. Cramming those onto the card is what made the previous
 * layout unreadable, and a grid gives even less room per item than a row did.
 *
 * The whole card is the button. A nested control inside a clickable card is
 * invalid markup, and the status needs to read as a state rather than a switch:
 * these are API keys, so there is nothing to toggle on or off.
 */
export function IntegrationCard({
  row,
  busy,
  onSave,
}: {
  row: RowModel;
  busy: string | null;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const { health, setting } = row;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);

  const service = SERVICES[row.id];
  const deps = DEPENDENTS[health.id] ?? [];
  const editable = setting !== null;
  const unset = editable && setting.source === "unset";
  const usage = health.usage?.[0];
  const renew = usage?.renewsAt ?? health.expiresAt ?? null;
  const pct =
    usage === undefined
      ? 0
      : Math.min(100, Math.round((usage.used / Math.max(1, usage.limit)) * 100));

  const StatusIcon = LEVEL_ICON[health.level];

  async function fetchKey(): Promise<string> {
    const res = await fetch("/api/settings/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: row.id }),
    });
    const data = (await res.json()) as { value?: string; error?: string };
    if (!res.ok || data.value === undefined) throw new Error(data.error ?? "Could not read the key");
    return data.value;
  }

  async function reveal() {
    if (revealed !== null) { setRevealed(null); return; }
    setRevealing(true);
    try {
      const v = await fetchKey();
      setRevealed(v === "" ? "(not set)" : v);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the key");
    } finally {
      setRevealing(false);
    }
  }

  async function copy() {
    try {
      const v = revealed ?? (await fetchKey());
      if (v === "" || v === "(not set)") { toast.error("Nothing to copy"); return; }
      await navigator.clipboard.writeText(v);
      setCopied(true);
      window.setTimeout(() => { setCopied(false); }, 2000);
      toast.success("Key copied");
    } catch {
      toast.error("Could not copy — use Reveal and copy manually");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); }}
        className={cn(
          "group flex h-full flex-col rounded-xl border bg-card p-5 text-left transition-all",
          "hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          health.level === "failing"
            ? "border-destructive/40"
            : health.level === "warning"
              ? "border-warning/40"
              : "border-border",
        )}
      >
        <ServiceIcon id={row.id} vendor={service?.vendor ?? row.name} />

        <h3 className="mt-4 truncate text-sm font-semibold">{row.name}</h3>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {row.description || row.category}
        </p>

        {/* Usage is the one operational figure worth showing here — a quota
            close to its limit is the thing an owner needs to spot early. */}
        {usage !== undefined && (
          <div className="mt-3">
            <div className="tabular flex items-baseline justify-between text-[11px] text-muted-foreground">
              <span>
                {usage.used.toLocaleString("en-US")} / {usage.limit.toLocaleString("en-US")}
              </span>
              <span>{String(pct)}%</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  pct >= 100 ? "bg-destructive" : pct >= 85 ? "bg-warning" : "bg-success",
                )}
                style={{ width: `${String(pct)}%` }}
              />
            </div>
          </div>
        )}

        {/* Footer pinned to the bottom so every card in a row lines up. */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          {unset ? (
            <span className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors group-hover:border-primary/40 group-hover:text-primary">
              Set up
            </span>
          ) : (
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", LEVEL_TEXT[health.level])}>
              <StatusIcon className="size-3.5" aria-hidden />
              {LEVEL_LABEL[health.level]}
            </span>
          )}
          <span
            aria-hidden
            className={cn("size-2.5 shrink-0 rounded-full", unset ? "bg-muted-foreground/30" : LEVEL_DOT[health.level])}
          />
        </div>
      </button>

      {/* ------------------------------------------------------ detail */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-start gap-3 pr-6">
              <ServiceIcon id={row.id} vendor={service?.vendor ?? row.name} />
              <div className="min-w-0">
                <DialogTitle className="truncate">{row.name}</DialogTitle>
                <DialogDescription className="mt-1">{row.description}</DialogDescription>
                <span
                  className={cn(
                    "mt-2 inline-flex items-center gap-1.5 text-xs font-medium",
                    LEVEL_TEXT[health.level],
                  )}
                >
                  <StatusIcon className="size-3.5" aria-hidden />
                  {LEVEL_LABEL[health.level]} · {health.summary}
                </span>
              </div>
            </div>
          </DialogHeader>

          <p className="text-xs leading-relaxed text-muted-foreground">{health.reason}</p>

          {/* ---- the key ---- */}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {editable ? "API key" : "Managed in"}
            </p>
            <div className="mt-1 flex items-center gap-1">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-2 font-mono text-xs">
                {revealed ??
                  (editable
                    ? setting.preview === ""
                      ? "Not configured"
                      : setting.preview
                    : "hosting environment")}
              </code>
              {editable && (
                <>
                  <button
                    type="button"
                    onClick={() => void reveal()}
                    disabled={revealing}
                    aria-label={revealed !== null ? `Hide ${row.name} key` : `Reveal ${row.name} key`}
                    className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {revealing ? <Loader2 className="size-4 animate-spin" /> : revealed !== null ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copy()}
                    aria-label={`Copy ${row.name} key`}
                    className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ---- provenance and dates ---- */}
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <Fact label="Category">{row.category}</Fact>
            <Fact label="Source">
              {editable
                ? setting.source === "db" ? "Set here" : setting.source === "env" ? "Environment" : "Not set"
                : "Environment"}
            </Fact>
            <Fact label="Changed">
              {setting?.updatedAt != null ? fmtDate(setting.updatedAt) : "Never"}
            </Fact>
            <Fact label={health.expiresAt !== null ? "Expires" : "Renews"}>
              {renew === null ? (
                <span className="text-muted-foreground">Does not expire</span>
              ) : (
                <>
                  {fmtDate(renew)}{" "}
                  <span className={cn(daysFrom(renew) <= 30 ? "text-warning" : "text-muted-foreground")}>
                    ({daysFrom(renew) < 0 ? "lapsed" : `${String(daysFrom(renew))} days`})
                  </span>
                </>
              )}
            </Fact>
            <Fact label="Usage">
              {usage === undefined ? (
                <span className="text-muted-foreground">Not published by the provider</span>
              ) : (
                `${usage.used.toLocaleString("en-US")} / ${usage.limit.toLocaleString("en-US")} ${usage.unit}`
              )}
            </Fact>
            {health.facts.map((f) => (
              <Fact key={f.label} label={f.label}>
                <span title={f.value}>{f.value}</span>
              </Fact>
            ))}
          </dl>

          {/* ---- edit ---- */}
          {editable && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium">
                {unset ? "Add the key" : "Replace the key"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  id={setting.key}
                  type={setting.secret ? "password" : "text"}
                  value={draft}
                  /* Chrome fills saved credentials into key fields unless told otherwise. */
                  autoComplete="new-password"
                  name={`setting-${setting.key.toLowerCase()}`}
                  data-1p-ignore
                  data-lpignore="true"
                  /*
                   * Suggestions, not a closed list. A <select> would mean a
                   * deploy every time the vendor ships a model, which is the
                   * one thing this setting exists to avoid.
                   */
                  list={setting.options ? `${setting.key}-options` : undefined}
                  placeholder={setting.placeholder}
                  onChange={(e) => { setDraft(e.target.value); }}
                  className="h-9 min-w-0 flex-1"
                />
                {setting.options && (
                  <datalist id={`${setting.key}-options`}>
                    {setting.options.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                )}
                <Button
                  size="sm"
                  className="h-9"
                  disabled={busy !== null || draft.trim() === ""}
                  onClick={() => void onSave(setting.key, draft).then(() => { setDraft(""); setRevealed(null); })}
                >
                  {busy === setting.key ? <Loader2 className="animate-spin" /> : <Check />}
                  Save
                </Button>
                {setting.source === "db" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    disabled={busy !== null}
                    onClick={() => void onSave(setting.key, "").then(() => { setRevealed(null); })}
                  >
                    <RotateCcw />
                    Reset
                  </Button>
                )}
              </div>
            </div>
          )}

          {service && (
            <a
              href={service.console}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {service.consoleLabel}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}

          {deps.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium">
                If this breaks: {deps.length} affected
                {deps.some((d) => d.level === "stops") &&
                  `, ${String(deps.filter((d) => d.level === "stops").length)} stop entirely`}
              </p>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {deps.map((d) => (
                  <li key={d.feature} className="text-[11px] leading-relaxed">
                    <a href={d.href} className="font-medium text-primary hover:underline">{d.feature}</a>
                    <span className={cn("ml-1 rounded px-1 py-px font-medium",
                      d.level === "stops" ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning")}>
                      {d.level}
                    </span>
                    <span className="text-muted-foreground"> — {d.consequence}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
