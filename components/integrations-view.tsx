"use client";

import {
  AlertTriangle,
  CalendarClock,
  CircleCheck,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { IntegrationRow, type RowModel } from "@/components/integrations/integration-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SERVICES } from "@/lib/integrations-catalog";
import { affectedNow } from "@/lib/integrations-impact";
import type { SettingView } from "@/lib/settings";
import type { HealthCheck } from "@/lib/settings-health";
import { cn } from "@/lib/utils";

/** What each row is for, in the owner's language rather than the field name. */
const COPY: Record<string, { description: string; category: string }> = {
  SERPAPI_KEY: {
    description: "Google results, rank checks and competitor citations.",
    category: "SEO data provider",
  },
  GROK_API_KEY: {
    description: "AI writing for the Content Assistant and GEO Lab.",
    category: "AI service",
  },
  GROK_MODEL: {
    description: "Which model the AI key generates with.",
    category: "AI model",
  },
  GOOGLE_CLIENT_ID: {
    description: "Sign-in with Google, Search Console and Analytics.",
    category: "Authentication",
  },
  GOOGLE_CLIENT_SECRET: {
    description: "The secret half of the same OAuth client.",
    category: "Authentication",
  },
  GOOGLE_TOKENS: {
    description: "The Google account this deployment syncs data from.",
    category: "Connection",
  },
  DATABASE_URL: {
    description: "Every project, keyword, article and setting lives here.",
    category: "Infrastructure",
  },
  AUTH_SECRET: {
    description: "Signs sessions and encrypts stored Google tokens.",
    category: "Security",
  },
};

type TabId = "all" | "active" | "attention" | "unset";

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Link2;
  tone: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-lg font-semibold leading-tight">{value}</p>
        <p className="truncate text-[10px] text-muted-foreground">{hint}</p>
      </div>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="size-4" aria-hidden />
      </span>
    </div>
  );
}

/**
 * Owner-facing integrations, as a single non-scrolling screen.
 *
 * The page is a fixed-height column: stats, tabs and the footer stay put and
 * only the list scrolls, so the window never does. Every figure comes from a
 * live provider call — where a provider publishes nothing, the row says so
 * rather than showing a number that looks measured.
 */
export function IntegrationsView({ initial }: { initial: SettingView[] }) {
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [checking, setChecking] = useState(true);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabId>("all");

  const loadHealth = useCallback(async (force: boolean) => {
    setChecking(true);
    try {
      const res = await fetch(`/api/settings/health${force ? "?refresh=1" : ""}`);
      const data = (await res.json()) as { checks?: HealthCheck[]; error?: string };
      if (!res.ok || !data.checks) {
        toast.error(data.error ?? "Could not check the keys");
        return;
      }
      setChecks(data.checks);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth(false);
  }, [loadHealth]);

  async function save(key: string, value: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const data = (await res.json()) as { settings?: SettingView[]; error?: string };
      if (!res.ok || !data.settings) {
        toast.error(data.error ?? "Could not save");
        return;
      }
      setSettings(data.settings);
      toast.success(
        value.trim() === ""
          ? "Cleared — the environment value applies again"
          : "Saved — re-checking against the provider",
      );
      await loadHealth(true);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------------------------------------------------------- rows */

  const rows: RowModel[] = useMemo(() => {
    if (checks === null) return [];

    // The AI key and model share a probe, as do the two Google halves.
    const probeFor = (key: string) =>
      checks.find(
        (c) =>
          c.id ===
          (key === "GROK_MODEL"
            ? "GROK_API_KEY"
            : key === "GOOGLE_CLIENT_SECRET"
              ? "GOOGLE_CLIENT_ID"
              : key),
      );

    const editable: RowModel[] = settings.flatMap((s) => {
      const probe = probeFor(s.key);
      if (!probe) return [];
      return [
        {
          id: s.key,
          name: s.label,
          description: COPY[s.key]?.description ?? s.description,
          category: COPY[s.key]?.category ?? SERVICES[s.key]?.vendor ?? "Service",
          health: { ...probe, id: s.key, label: s.label },
          setting: s,
        },
      ];
    });

    const editableIds = new Set(["SERPAPI_KEY", "GROK_API_KEY", "GOOGLE_CLIENT_ID"]);
    const deployment: RowModel[] = checks
      .filter((c) => !editableIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.label,
        description: COPY[c.id]?.description ?? "",
        category: COPY[c.id]?.category ?? "Infrastructure",
        health: c,
        setting: null,
      }));

    return [...editable, ...deployment];
  }, [checks, settings]);

  const counts = useMemo(() => {
    const active = rows.filter((r) => r.health.level === "healthy").length;
    const attention = rows.filter(
      (r) => r.health.level === "failing" || r.health.level === "warning",
    ).length;
    const unset = rows.filter((r) => r.setting?.source === "unset").length;
    return { all: rows.length, active, attention, unset };
  }, [rows]);

  /** Real renewals only — a row with no published date is never counted. */
  const renewingSoon = useMemo(
    () =>
      rows.filter((r) => {
        const when = r.health.usage?.[0]?.renewsAt ?? r.health.expiresAt;
        if (when == null) return false;
        const days = (new Date(when).getTime() - Date.now()) / 86_400_000;
        return days >= 0 && days <= 30;
      }).length,
    [rows],
  );

  const lastChanged = useMemo(() => {
    const dates = settings
      .map((s) => s.updatedAt)
      .filter((d): d is string => d !== null)
      .sort()
      .reverse();
    return dates[0] ?? null;
  }, [settings]);

  const visible = rows.filter((r) => {
    const matchesTab =
      tab === "all"
        ? true
        : tab === "active"
          ? r.health.level === "healthy"
          : tab === "attention"
            ? r.health.level === "failing" || r.health.level === "warning"
            : r.setting?.source === "unset";

    const q = query.trim().toLowerCase();
    const matchesQuery =
      q === "" ||
      r.name.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      (SERVICES[r.id]?.vendor ?? "").toLowerCase().includes(q);

    return matchesTab && matchesQuery;
  });

  const affected = checks === null ? [] : affectedNow(checks);

  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: "all", label: "All integrations", count: counts.all },
    { id: "active", label: "Active", count: counts.active },
    { id: "attention", label: "Needs attention", count: counts.attention },
    { id: "unset", label: "Not configured", count: counts.unset },
  ];

  return (
    // Fixed-height column: only the list scrolls, so the window never does.
    <div className="flex min-h-0 flex-col gap-3 lg:flex-1">
      {/* ---------------- stats ---------------- */}
      <div className="grid shrink-0 gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Integrations"
          value={String(counts.all)}
          hint="Services in use"
          icon={Link2}
          tone="bg-primary/12 text-primary"
        />
        <StatTile
          label="Active"
          value={String(counts.active)}
          hint="Answering normally"
          icon={CircleCheck}
          tone="bg-success/12 text-success"
        />
        <StatTile
          label="Needs attention"
          value={String(counts.attention)}
          hint="Failing or at risk"
          icon={AlertTriangle}
          tone={counts.attention > 0 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}
        />
        <StatTile
          label="Renewing in 30 days"
          value={String(renewingSoon)}
          hint="Provider-stated dates only"
          icon={CalendarClock}
          tone="bg-chart-3/12 text-chart-3"
        />
        <StatTile
          label="Last key change"
          value={
            lastChanged === null
              ? "—"
              : new Date(lastChanged).toLocaleDateString("en-US", { day: "numeric", month: "short" })
          }
          hint={lastChanged === null ? "Never changed here" : "Changed on this page"}
          icon={ShieldCheck}
          tone="bg-muted text-muted-foreground"
        />
      </div>

      {/* ---------------- tabs, search, re-check ---------------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter integrations">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => { setTab(t.id); }}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs transition-colors",
                tab === t.id
                  ? "bg-primary/12 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <div className="relative ml-auto min-w-0 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder="Search integrations…"
            aria-label="Search integrations"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={checking}
          onClick={() => void loadHealth(true)}
        >
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Re-check
        </Button>
      </div>

      {/* ---------------- affected ---------------- */}
      {affected.length > 0 && (
        <div className="shrink-0 rounded-xl border border-warning/40 bg-warning/5 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {affected.length} {affected.length === 1 ? "feature" : "features"} affected right now
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {affected.map((a) => `${a.feature} (${a.level})`).join(" · ")}
          </p>
        </div>
      )}

      {/* ---------------- the list ---------------- */}
      <div className="min-h-0 space-y-2 lg:flex-1 lg:overflow-y-auto lg:pr-1" aria-label="Integrations">
        {checks === null ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-card" />
          ))
        ) : visible.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing matches that filter.
          </p>
        ) : (
          visible.map((r) => <IntegrationRow key={r.id} row={r} busy={busy} onSave={save} />)
        )}
      </div>

      {/* ---------------- footer ---------------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
        <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Keys are encrypted at rest.</span>{" "}
          A full key is fetched only when you press the eye, so it never appears in
          the page source or in a screenshot. Statuses come from a live call to each
          provider, cached for five minutes.
        </p>
      </div>
    </div>
  );
}
