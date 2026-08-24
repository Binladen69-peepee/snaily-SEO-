import { AuditView } from "@/components/audit/audit-view";
import { AuditTabs } from "@/components/audit/tabs";
import { PageHeader } from "@/components/tool-shell";
import { getSession } from "@/lib/auth";
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

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      {/* Audits always run against the active project, so there is no domain box. */}
      <PageHeader
        title="Site Audit"
        description={
          project
            ? `Crawl and analyse ${project.url.replace(/^https?:\/\//, "")}`
            : "Select a project to run an audit."
        }
      />

      <AuditTabs />

      <AuditView
        projectId={project?.id ?? null}
        projectName={project?.name ?? null}
        projectUrl={project?.url ?? null}
        initialAuditId={latestId}
      />
    </div>
  );
}
