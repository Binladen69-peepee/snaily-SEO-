import { AuditView } from "@/components/audit/audit-view";
import { AuditTabs } from "@/components/audit/tabs";
import { CompetitiveAnalysisShell } from "@/components/competitors/competitive-analysis-shell";
import { getSession } from "@/lib/auth";
import { normalizeDomain } from "@/lib/competitors";
import { prisma } from "@/lib/db";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Content Audit · Snaily SEO" };

export default async function AuditPage() {
  const [session, project] = await Promise.all([
    getSession(),
    getActiveProject(),
  ]);

  let latestId: string | null = null;

  if (session && project) {
    const latest = await prisma.audit.findFirst({
      where: { userId: session.userId, projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    latestId = latest?.id ?? null;
  }

  const domain = project ? normalizeDomain(project.url) : "";

  return (
    <CompetitiveAnalysisShell domain={domain} showSearch={false}>
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
          <h2 className="text-sm font-bold">Site Audit</h2>
          <p className="text-[11px] text-muted-foreground">
            {project
              ? `Crawl and analyze ${project.url.replace(/^https?:\/\//, "")}`
              : "Select a project to run an audit."}
          </p>
        </div>

        <AuditTabs />

        <AuditView
          projectId={project?.id ?? null}
          projectName={project?.name ?? null}
          projectUrl={project?.url ?? null}
          initialAuditId={latestId}
        />
      </div>
    </CompetitiveAnalysisShell>
  );
}
