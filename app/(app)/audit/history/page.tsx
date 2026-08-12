import {
  HistoryView,
  type AuditHistoryItem,
} from "@/components/audit/history-view";
import { AuditTabs } from "@/components/audit/tabs";
import type { AuditStatus } from "@/lib/audit/types";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Audit History · Snaily SEO" };

async function getAudits(): Promise<AuditHistoryItem[]> {
  const [session, project] = await Promise.all([
    getSession(),
    getActiveProject(),
  ]);
  if (!session || !project) return [];

  const docs = await prisma.audit.findMany({
    where: { userId: session.userId, projectId: project.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return docs.map((a) => ({
    id: a.id,
    status: a.status as AuditStatus,
    pagesCrawled: a.pagesCrawled,
    healthScore: a.healthScore,
    totalIssues: a.totalIssues,
    startedAt: a.startedAt.toISOString(),
    finishedAt: a.finishedAt?.toISOString() ?? null,
  }));
}

export default async function AuditHistoryPage() {
  const [audits, project] = await Promise.all([getAudits(), getActiveProject()]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit History</h1>
        <p className="text-sm text-muted-foreground">
          {project ? `Past audits for ${project.name}` : "Select a project."}
        </p>
      </div>

      <AuditTabs />

      <HistoryView audits={audits} />
    </div>
  );
}
