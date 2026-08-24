"use client";

import { Check, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Option = { id: string; name: string };

type Properties = {
  searchConsole: Option[];
  analytics: Option[];
  searchConsoleError: string | null;
  analyticsError: string | null;
  error?: string;
  needsGoogle?: boolean;
};

export type ProjectGoogleLinks = {
  gscSiteUrl: string | null;
  gscSiteName: string | null;
  ga4PropertyId: string | null;
  ga4PropertyName: string | null;
};

/**
 * Links a project to one Search Console site and one GA4 property.
 *
 * The properties come from the Google account authorised at sign-in, so this
 * never triggers a consent screen — it is a choice, not a connection. Each
 * project can point somewhere different under the same account.
 */
export function GoogleProperties({
  projectId,
  initial,
  googleEmail,
}: {
  projectId: string;
  initial: ProjectGoogleLinks;
  /** Null when the user signed in with a password rather than Google. */
  googleEmail: string | null;
}) {
  const [links, setLinks] = useState(initial);
  const [props, setProps] = useState<Properties | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {

    setLoading(true);
    try {
      const res = await fetch("/api/google/properties");
      const data = (await res.json()) as Properties;
      setProps(data);
      if (!res.ok && data.needsGoogle !== true) {
        toast.error(data.error ?? "Could not list Google properties");
      }
    } catch {
      toast.error("Could not reach Google");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (googleEmail !== null) void load();
  }, [googleEmail, load]);

  async function save(patch: Partial<ProjectGoogleLinks>) {
    setSaving(true);
    const next = { ...links, ...patch };
    try {
      const res = await fetch("/api/google/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...patch }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Could not link that property");
        return;
      }
      setLinks(next);
      toast.success("Property linked");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as {
        rowsImported?: number;
        errors?: string[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Sync failed");
        return;
      }
      toast.success(`Imported ${String(data.rowsImported ?? 0)} rows`);
      if (data.errors && data.errors.length > 0) {
        toast.error(data.errors.join(" · "));
      }
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSyncing(false);
    }
  }

  if (googleEmail === null) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Google data</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with Google to link Search Console and Analytics. One sign-in
          covers every project — you will not be asked again.
        </p>
        <Button asChild size="sm" className="mt-3">
          <a href="/api/auth/google?next=/projects">Continue with Google</a>
        </Button>
      </div>
    );
  }

  

  const picker = (
    label: string,
    options: Option[],
    error: string | null,
    currentId: string | null,
    onPick: (o: Option | null) => void,
  ) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {error !== null ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2 text-xs text-muted-foreground">
          {error}
        </p>
      ) : (
        <select
          value={currentId ?? ""}
          disabled={saving || loading}
          onChange={(e) => {
            const id = e.target.value;
            onPick(id === "" ? null : (options.find((o) => o.id === id) ?? null));
          }}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Not linked</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Google data</h3>
          <p className="text-xs text-muted-foreground">
            Signed in as {googleEmail}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Refresh
        </Button>
      </div>
      

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {picker(
          "Search Console property",
          props?.searchConsole ?? [],
          props?.searchConsoleError ?? null,
          links.gscSiteUrl,
          (o) => {
            void save({
              gscSiteUrl: o?.id ?? null,
              gscSiteName: o?.name ?? null,
            });
          },
        )}
        {picker(
          "Analytics (GA4) property",
          props?.analytics ?? [],
          props?.analyticsError ?? null,
          links.ga4PropertyId,
          (o) => {
            void save({
              ga4PropertyId: o?.id ?? null,
              ga4PropertyName: o?.name ?? null,
            });
          },
        )}
      </div>


      {(links.gscSiteUrl !== null || links.ga4PropertyId !== null) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="size-3.5" aria-hidden />
            Linked used automatically for rank tracking, metrics and content
            intelligence
          </span>
          <div className="flex-1" />
          <Button size="sm" onClick={() => void sync()} disabled={syncing}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      )}
    </div>
  );
}
