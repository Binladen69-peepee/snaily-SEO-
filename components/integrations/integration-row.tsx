"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
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
import { Input } from "@/components/ui/input";
import { initialsFor, SERVICES } from "@/lib/integrations-catalog";
import { DEPENDENTS } from "@/lib/integrations-impact";
import type { SettingView } from "@/lib/settings";
import type { HealthCheck, HealthLevel } from "@/lib/settings-health";
import { cn } from "@/lib/utils";

const LEVEL_LABEL: Record<HealthLevel, string> = {
  healthy: "Active",
  warning: "At risk",
  failing: "Not working",
  unknown: "Unverified",
};

const LEVEL_TONE: Record<HealthLevel, string> = {
  healthy: "bg-success/12 text-success ring-success/20",
  warning: "bg-warning/15 text-warning ring-warning/25",
  failing: "bg-destructive/10 text-destructive ring-destructive/25",
  unknown: "bg-muted text-muted-foreground ring-border",
};

const LEVEL_ICON: Record<HealthLevel, typeof CircleCheck> = {
  healthy: CircleCheck,
  warning: AlertTriangle,
  failing: CircleX,
  unknown: CircleHelp,
};

export function StatusPill({ level }: { level: HealthLevel }) {
  const Icon = LEVEL_ICON[level];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        LEVEL_TONE[level],
      )}
    >
      <Icon className="size-3" aria-hidden />
      {LEVEL_LABEL[level]}
    </span>
  );
}

function ServiceIcon({ id, vendor }: { id: string; vendor: string }) {
  const [broken, setBroken] = useState(false);
  const src = SERVICES[id]?.favicon;

  if (broken || !src) {
    return (
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xs font-semibold text-muted-foreground"
      >
        {initialsFor(vendor)}
      </span>
    );
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/60 ring-1 ring-inset ring-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={22}
        height={22}
        referrerPolicy="no-referrer"
        onError={() => { setBroken(true); }}
        className="size-[22px] object-contain"
      />
    </span>
  );
}

/** A labelled cell in the row's middle columns. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-xs">{children}</dd>
    </div>
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
 * One integration, as a full-width horizontal row.
 *
 * Everything an owner checks at a glance sits on a single line — key, status,
 * renewal, consumption — with the detail behind an expander so the list stays
 * short enough to read without scrolling the page.
 */
export function IntegrationRow({
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
  const usage = health.usage?.[0];
  const renew = usage?.renewsAt ?? health.expiresAt ?? null;

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
    <div
      className={cn(
        "rounded-xl border bg-card transition-colors",
        health.level === "failing"
          ? "border-destructive/40"
          : health.level === "warning"
            ? "border-warning/40"
            : "border-border",
      )}
    >
      <div className="grid grid-cols-1 items-center gap-3 px-3 py-2.5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        {/* ---- identity ---- */}
        <div className="flex min-w-0 items-center gap-2.5">
          <ServiceIcon id={row.id} vendor={service?.vendor ?? row.name} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold">{row.name}</h3>
              <StatusPill level={health.level} />
            </div>
            <p className="truncate text-[11px] text-muted-foreground">{row.description}</p>
            <span className="mt-0.5 inline-block rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
              {row.category}
            </span>
          </div>
        </div>

        {/* ---- key and provenance ---- */}
        <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1">
          <div className="col-span-2 min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {editable ? "API key" : "Managed in"}
            </dt>
            <dd className="mt-0.5 flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 font-mono text-[11px]">
                {revealed ?? (editable ? (setting.preview === "" ? "Not configured" : setting.preview) : "hosting environment")}
              </code>
              {editable && (
                <>
                  <button
                    type="button"
                    onClick={() => void reveal()}
                    disabled={revealing}
                    aria-label={revealed !== null ? `Hide ${row.name} key` : `Reveal ${row.name} key`}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {revealing ? <Loader2 className="size-3.5 animate-spin" /> : revealed !== null ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copy()}
                    aria-label={`Copy ${row.name} key`}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </button>
                </>
              )}
            </dd>
          </div>

          <Cell label="Source">
            {editable
              ? setting.source === "db" ? "Set here" : setting.source === "env" ? "Environment" : "Not set"
              : "Environment"}
          </Cell>
          <Cell label="Changed">
            {setting?.updatedAt != null ? fmtDate(setting.updatedAt) : "—"}
          </Cell>
        </dl>

        {/* ---- status, renewal, usage ---- */}
        <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1">
          <Cell label={health.expiresAt !== null ? "Expires" : "Renews"}>
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
          </Cell>
          <Cell label="Status">{health.summary}</Cell>

          <div className="col-span-2 min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Usage</dt>
            <dd className="mt-0.5">
              {usage === undefined ? (
                <span className="text-xs text-muted-foreground">Not published by the provider</span>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="tabular">
                      {usage.used.toLocaleString("en-US")} / {usage.limit.toLocaleString("en-US")} {usage.unit}
                    </span>
                    <span className="tabular text-muted-foreground">
                      {String(Math.round((usage.used / Math.max(1, usage.limit)) * 100))}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        usage.used / usage.limit >= 1 ? "bg-destructive"
                          : usage.used / usage.limit >= 0.85 ? "bg-warning" : "bg-success",
                      )}
                      style={{ width: `${String(Math.min(100, Math.round((usage.used / Math.max(1, usage.limit)) * 100)))}%` }}
                    />
                  </div>
                </>
              )}
            </dd>
          </div>
        </dl>

        {/* ---- actions ---- */}
        <div className="flex shrink-0 items-center gap-1.5 justify-self-start lg:justify-self-end">
          <Button
            size="sm"
            variant={health.level === "failing" && editable ? "default" : "outline"}
            className="h-8"
            aria-expanded={open}
            onClick={() => { setOpen((v) => !v); }}
          >
            {editable && setting.source === "unset" ? "Configure" : "Details"}
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>

      {/* ---- expanded detail ---- */}
      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {health.reason}
          </p>

          {service && (
            <a
              href={service.console}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {service.consoleLabel}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}

          {health.facts.length > 0 && (
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-3">
              {health.facts.map((f) => (
                <div key={f.label} className="flex min-w-0 gap-1.5 text-[11px]">
                  <dt className="shrink-0 text-muted-foreground">{f.label}:</dt>
                  <dd className="min-w-0 truncate" title={f.value}>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {editable && (
            <div className="flex flex-wrap gap-2">
              <Input
                id={setting.key}
                type={setting.secret ? "password" : "text"}
                value={draft}
                /* Chrome fills saved credentials into key fields unless told otherwise. */
                autoComplete="new-password"
                name={`setting-${setting.key.toLowerCase()}`}
                data-1p-ignore
                data-lpignore="true"
                placeholder={setting.placeholder}
                onChange={(e) => { setDraft(e.target.value); }}
                className="h-8 min-w-0 flex-1"
              />
              <Button
                size="sm"
                className="h-8"
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
                  className="h-8"
                  disabled={busy !== null}
                  onClick={() => void onSave(setting.key, "").then(() => { setRevealed(null); })}
                >
                  <RotateCcw />
                  Reset
                </Button>
              )}
            </div>
          )}

          {deps.length > 0 && (
            <div>
              <p className="text-[11px] font-medium">
                If this breaks: {deps.length} affected
                {deps.some((d) => d.level === "stops") &&
                  `, ${String(deps.filter((d) => d.level === "stops").length)} stop entirely`}
              </p>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                {deps.map((d) => (
                  <li key={d.feature} className="text-[11px]">
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
        </div>
      )}
    </div>
  );
}
