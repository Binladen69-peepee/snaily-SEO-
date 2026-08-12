import { Activity } from "lucide-react";
import Link from "next/link";

import { RankTrackerView } from "@/components/tracking/rank-tracker-view";
import { ToolPrompt } from "@/components/tool-shell";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveProject } from "@/lib/projects";
import { discoverKeywords, domainOf, listTracked } from "@/lib/rank-tracker";

export const metadata = { title: "Rank Tracker · Snaily SEO" };

export default async function TrackingPage() {
  const [session, project] = await Promise.all([
    getSession(),
    getActiveProject(),
  ]);

  if (!session || !project) {
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Rank Tracker</h1>
        <ToolPrompt icon={Activity} title="Create a project first">
          Rank tracking follows one site at a time.{" "}
          <Link href="/projects" className="text-primary hover:underline">
            Add your site
          </Link>{" "}
          to get started.
        </ToolPrompt>
      </div>
    );
  }

  const [keywords, discovered, connection] = await Promise.all([
    listTracked(project.id, session.userId),
    discoverKeywords(project.id),
    prisma.project.findUnique({
      where: { id: project.id },
      select: { gscSiteUrl: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-[1400px]">
      <RankTrackerView
        initial={keywords}
        projectId={project.id}
        domain={domainOf(project.url)}
        discovered={discovered}
        searchConsoleReady={connection?.gscSiteUrl != null}
      />
    </div>
  );
}
