import { KeyRound } from "lucide-react";
import { notFound } from "next/navigation";

import { IntegrationsConnections } from "@/components/integrations-connections";
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
      A fixed-height screen rather than a scrolling document: the header,
      connections summary and stat tiles stay put and only the integration
      list scrolls, so the window itself never does.
    */
    <div className="mx-auto flex min-h-0 max-w-7xl flex-col gap-3 lg:h-[calc(100svh-6.5rem)] lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
          <p className="text-xs text-muted-foreground">
            Manage API keys and service connections for this deployment.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
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

      <IntegrationsView initial={settings} />
    </div>
  );
}
