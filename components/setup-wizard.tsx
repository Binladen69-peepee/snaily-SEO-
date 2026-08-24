"use client";

import {
  ArrowRight,
  Check,
  CircleAlert,
  Globe,
  Loader2,
  Plug,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ConnectionStatus } from "@/lib/wordpress/sync";
import { cn } from "@/lib/utils";
import { useSetup } from "@/components/setup/setup-provider";
import { WordpressSetupPanel } from "@/components/setup/wordpress-setup-panel";
import type { SetupSnapshot } from "@/lib/setup/state";

type Option = { id: string; name: string };

type Properties = {
  searchConsole: Option[];
  analytics: Option[];
  searchConsoleError: string | null;
  analyticsError: string | null;
  needsGoogle?: boolean;
};

export type SetupProject = {
  id: string;
  name: string;
  url: string;
  gscSiteUrl: string | null;
  gscSiteName: string | null;
  ga4PropertyId: string | null;
  ga4PropertyName: string | null;
};

const STEPS = [
  { id: 0, label: "Your Site" },
  { id: 1, label: "Google Data" },
  { id: 2, label: "WordPress" },
  { id: 3, label: "You're Ready" },
] as const;

/**
 * First-run setup for a new project.
 *
 * Four steps, each independently skippable — the tool does something useful
 * with none of them connected, so nothing here is allowed to become a wall.
 * Progress is saved as each step completes rather than at the end, so closing
 * the tab half way through loses nothing.
 */
export function SetupWizard({
  project,
  initialStatus,
  googleEmail,
  initialSnapshot,
}: {
  project: SetupProject;
  initialStatus: ConnectionStatus | null;
  googleEmail: string | null;
  initialSnapshot: SetupSnapshot | null;
}) {
  const router = useRouter();
  const { snapshot: ctxSnap, setSnapshot: setCtxSnap } = useSetup();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const [status, setStatus] = useState(initialStatus);
  const [snap, setSnap] = useState<SetupSnapshot | null>(
    initialSnapshot ??
      (ctxSnap?.projectId === project.id ? ctxSnap : null),
  );

  const [props, setProps] = useState<Properties | null>(null);
  const [loadingProps, setLoadingProps] = useState(false);
  const [links, setLinks] = useState({
    gscSiteUrl: project.gscSiteUrl,
    gscSiteName: project.gscSiteName,
    ga4PropertyId: project.ga4PropertyId,
    ga4PropertyName: project.ga4PropertyName,
  });

  const loadProperties = useCallback(async () => {
    setLoadingProps(true);
    try {
      const res = await fetch("/api/google/properties");
      setProps((await res.json()) as Properties);
    } catch {
      toast.error("Could not reach Google");
    } finally {
      setLoadingProps(false);
    }
  }, []);

  useEffect(() => {
    if (step === 1 && googleEmail !== null && props === null) {
      void loadProperties();
    }
  }, [step, googleEmail, props, loadProperties]);

  function pushSnap(next: SetupSnapshot) {
    setSnap(next);
    if (ctxSnap === null || ctxSnap.projectId === project.id) {
      setCtxSnap(next);
    }
    if (next.wordpress.health === "connected") {
      setStatus({
        connected: true,
        siteUrl: next.wordpress.siteUrl,
        siteName: next.wordpress.siteName,
        seoPlugin: status?.seoPlugin ?? "none",
        wpVersion: status?.wpVersion ?? "",
        lastError: null,
        lastSyncedAt: next.wordpress.lastSyncedAt,
        postCount: status?.postCount ?? 0,
      });
    }
  }

  async function linkProperty(patch: Partial<typeof links>) {
    const next = { ...links, ...patch };
    setLinks(next);
    try {
      await fetch("/api/google/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, ...patch }),
      });
    } catch {
      toast.error("Could not save that property");
    }
  }

  /** Last step: pull content in, mark setup done, then land on the app. */
  async function finish(runSync: boolean) {
    setBusy(true);
    try {
      if (runSync && snap?.wordpress.health === "connected") {
        const res = await fetch("/api/wordpress/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, full: true }),
        });
        const data = (await res.json()) as { imported?: number; error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "Sync failed");
        } else {
          toast.success(`Imported ${String(data.imported ?? 0)} posts`);
        }
      }

      await fetch(`/api/projects/${project.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarded: true }),
      });

      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Could not reach the server");
      setBusy(false);
    }
  }

  const connected = snap?.wordpress.health === "connected";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Let&apos;s get you set up
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Four quick steps to connect {project.name} and start auditing content.
        </p>
      </div>

      {/* Stepper */}
      <ol className="mt-7 flex items-center justify-center gap-1 sm:gap-2">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={s.id} className="flex min-w-0 items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep(i);
                }}
                className="flex min-w-0 flex-col items-center gap-1.5"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                    done && "border-primary bg-primary/10 text-primary",
                    active && "border-primary bg-primary text-primary-foreground",
                    !done && !active && "border-border text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "hidden truncate text-[11px] sm:block",
                    active ? "font-medium text-primary" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className={cn(
                    "h-px w-6 shrink-0 sm:w-12",
                    i < step ? "bg-primary" : "bg-border",
                  )}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-7 rounded-2xl border border-border bg-card p-4 sm:p-6">
        {/* ---------------------------------------------------------- 1 */}
        {step === 0 && (
          <section>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Globe className="size-4 text-primary" />
              Your site
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This is what the rest of the setup connects to.
            </p>

            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-xs text-muted-foreground">Site name</dt>
                <dd className="text-sm font-medium">{project.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Site URL</dt>
                <dd className="break-all text-sm font-medium">{project.url}</dd>
              </div>
            </dl>

            <p className="mt-4 text-xs text-muted-foreground">
              Wrong details? Change them in project settings — you can come back
              to this wizard at any time.
            </p>

            <div className="mt-5 flex justify-end">
              <Button
                onClick={() => {
                  setStep(1);
                }}
              >
                Continue
                <ArrowRight />
              </Button>
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------- WordPress */}
        {step === 2 && (
          <section>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Plug className="size-4 text-primary" />
              WordPress connector
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional. Skip if this site is not WordPress — keyword research,
              audits and rank tracking still work.
            </p>

            {snap !== null ? (
              <div className="mt-4">
                <WordpressSetupPanel
                  projectId={project.id}
                  snapshot={snap}
                  onSnapshot={pushSnap}
                />
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Switch to this project in the header, then return here to connect
                WordPress.
              </p>
            )}

            <div className="mt-5 flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep(1);
                }}
              >
                Back
              </Button>
              <div className="flex items-center gap-2">
                {!connected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStep(3);
                    }}
                  >
                    Skip for now
                  </Button>
                )}
                <Button
                  onClick={() => {
                    setStep(3);
                  }}
                >
                  Continue
                  <ArrowRight />
                </Button>
              </div>
            </div>
          </section>
        )}
        {/* ---------------------------------------------------------- Google */}
        {step === 1 && (
          <section>
            <h2 className="text-base font-semibold">Connect Google</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search Console clicks and GA4 sessions decide which posts are worth
              updating first.
            </p>

            {googleEmail === null ? (
              <div className="mt-4 rounded-lg border border-border bg-background p-4">
                <p className="text-sm text-muted-foreground">
                  Sign in with Google to link Search Console and Analytics. One
                  sign-in covers every project.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <a href={`/api/auth/google?next=/projects/${project.id}/setup`}>
                    Continue with Google
                  </a>
                </Button>
              </div>
            ) : (
              <>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-success">
                  <Check className="size-3.5" />
                  Signed in as {googleEmail}
                </p>

                <div className="mt-4 space-y-4">
                  <PropertyPicker
                    label="Search Console property"
                    options={props?.searchConsole ?? []}
                    error={props?.searchConsoleError ?? null}
                    loading={loadingProps}
                    value={links.gscSiteUrl}
                    onPick={(o) => {
                      void linkProperty({
                        gscSiteUrl: o?.id ?? null,
                        gscSiteName: o?.name ?? null,
                      });
                    }}
                  />
                  <PropertyPicker
                    label="Google Analytics 4 property"
                    options={props?.analytics ?? []}
                    error={props?.analyticsError ?? null}
                    loading={loadingProps}
                    value={links.ga4PropertyId}
                    onPick={(o) => {
                      void linkProperty({
                        ga4PropertyId: o?.id ?? null,
                        ga4PropertyName: o?.name ?? null,
                      });
                    }}
                  />
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  onClick={() => void loadProperties()}
                  disabled={loadingProps}
                >
                  {loadingProps ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  Refresh list
                </Button>
              </>
            )}

            <div className="mt-5 flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep(0);
                }}
              >
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep(2);
                  }}
                >
                  Skip for now
                </Button>
                <Button
                  onClick={() => {
                    setStep(2);
                  }}
                >
                  Continue
                  <ArrowRight />
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------- 4 */}
        {step === 3 && (
          <section className="text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10">
              <Check className="size-6 text-success" />
            </span>
            <h2 className="mt-3 text-lg font-semibold">You&apos;re all set</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Let&apos;s pull in your content and start the first audit.
            </p>

            <ul className="mt-5 space-y-2 rounded-lg border border-border bg-background p-3 text-left text-sm">
              <ChecklistRow label="Site details" done />
              <ChecklistRow
                label="Search Console"
                done={links.gscSiteUrl !== null}
                note={links.gscSiteUrl === null ? "skipped" : undefined}
              />
              <ChecklistRow
                label="Google Analytics"
                done={links.ga4PropertyId !== null}
                note={links.ga4PropertyId === null ? "skipped" : undefined}
              />
              <ChecklistRow
                label="WordPress connector"
                done={connected}
                note={connected ? undefined : "skipped — you can finish this later"}
              />
            </ul>

            {!connected && (
              <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-left text-xs text-muted-foreground">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                WordPress setup is incomplete. Send to WordPress and post sync
                stay unavailable until you connect the plugin. A reminder will
                appear in the app — keyword research, audits and rank tracking
                still work.
              </p>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <Button
                size="lg"
                onClick={() => void finish(true)}
                disabled={busy}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                {connected ? "Run first sync & finish" : "Finish setup"}
                <ArrowRight />
              </Button>
              {connected && (
                <button
                  type="button"
                  onClick={() => void finish(false)}
                  disabled={busy}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Skip sync, go to the app
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ChecklistRow({
  label,
  done,
  note,
}: {
  label: string;
  done: boolean;
  note?: string;
}) {
  return (
    <li className="flex items-center gap-2">
      {done ? (
        <Check className="size-4 shrink-0 text-success" />
      ) : (
        <span className="size-4 shrink-0 rounded-full border border-border" />
      )}
      <span className={done ? "" : "text-muted-foreground"}>{label}</span>
      {note !== undefined && (
        <span className="ml-auto text-xs text-muted-foreground">{note}</span>
      )}
    </li>
  );
}

function PropertyPicker({
  label,
  options,
  error,
  loading,
  value,
  onPick,
}: {
  label: string;
  options: Option[];
  error: string | null;
  loading: boolean;
  value: string | null;
  onPick: (option: Option | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {error !== null ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2 text-xs text-muted-foreground">
          {error}
        </p>
      ) : (
        <select
          value={value ?? ""}
          disabled={loading}
          onChange={(e) => {
            const id = e.target.value;
            onPick(id === "" ? null : (options.find((o) => o.id === id) ?? null));
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">— Select a property —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      {!loading && error === null && options.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No properties found on this Google account. The account needs Owner or
          Full user permission on the property.
        </p>
      )}
    </div>
  );
}
