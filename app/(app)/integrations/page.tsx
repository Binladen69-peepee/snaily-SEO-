import { KeyRound } from "lucide-react";
import { notFound } from "next/navigation";

import { IntegrationsConnections } from "@/components/integrations-connections";
import { IntegrationsConnector } from "@/components/integrations-connector";
import { IntegrationsView } from "@/components/integrations-view";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleAccountPublic } from "@/lib/google/account";
import { listSettings } from "@/lib/settings";
import { isOwner } from "@/lib/users";

export const metadata = { title: "Integrations · Snaily SEO" };

export default async function IntegrationsPage() {
  const session = await getSession();
  if (!session) notFound();

  // Deployment keys are owner-only; a VA must not see or rotate them.
  if (!(await isOwner(session.userId))) notFound();

  const [settings, account, projects] = await Promise.all([
    listSettings(),
    getGoogleAccountPublic(session.userId),
    prisma.project.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        url: true,
        gscSiteUrl: true,
        gscSiteName: true,
        ga4PropertyId: true,
        ga4PropertyName: true,
        gscSyncedAt: true,
        ga4SyncedAt: true,
        googleSyncError: true,
      },
    }),
  ]);

  return (
    /*
      A normal scrolling page. Pinning it to the viewport meant the list had a
      fixed ~500px to show eight rows of dense data, which is what made the
      screen feel cramped — the content now sets its own height.
    */
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage API keys and service connections for this deployment.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground">
          <KeyRound className="size-3.5" aria-hidden />
          Owner only
        </span>
      </div>

      <IntegrationsConnections
        account={
          account === null
            ? null
            : {
                email: account.email,
                hasSearchConsole: account.hasSearchConsole,
                hasAnalytics: account.hasAnalytics,
                lastError: account.lastError,
              }
        }
        projects={projects.map((p) => ({
          ...p,
          gscSyncedAt: p.gscSyncedAt?.toISOString() ?? null,
          ga4SyncedAt: p.ga4SyncedAt?.toISOString() ?? null,
        }))}
      />

      <IntegrationsConnector
        projects={projects.map((p) => ({ id: p.id, name: p.name, url: p.url }))}
      />

      <IntegrationsView initial={settings} />
    </div>
  );
}
