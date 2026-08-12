import { prisma } from "@/lib/db";

export type ProjectOverview = {
  lastAudit: {
    id: string;
    healthScore: number;
    totalIssues: number;
    pagesCrawled: number;
    finishedAt: string;
    status: string;
  } | null;
  searchConsole: {
    clicks: number;
    impressions: number;
    avgPosition: number;
  } | null;
  trackedKeywords: number;
  keywordLists: number;
  articles: number;
  setup: {
    hasGoogle: boolean;
    hasAudit: boolean;
    hasTracking: boolean;
    hasBusinessFacts: boolean;
  };
};

export async function getProjectOverview(
  projectId: string,
  userId: string,
): Promise<ProjectOverview> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 28);

  const [
    project,
    lastAudit,
    gscAgg,
    trackedKeywords,
    keywordLists,
    articles,
    facts,
  ] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, userId },
      select: {
        gscSiteUrl: true,
        ga4PropertyId: true,
      },
    }),
    prisma.audit.findFirst({
      where: { projectId, userId, status: "completed" },
      orderBy: { finishedAt: "desc" },
      select: {
        id: true,
        healthScore: true,
        totalIssues: true,
        pagesCrawled: true,
        finishedAt: true,
        status: true,
      },
    }),
    prisma.gscQueryMetric.groupBy({
      by: ["projectId"],
      where: { projectId, date: { gte: since } },
      _sum: { clicks: true, impressions: true },
      _avg: { position: true },
    }),
    prisma.trackedKeyword.count({ where: { projectId, userId } }),
    prisma.keywordList.count({ where: { projectId, userId } }),
    prisma.article.count({ where: { projectId, userId } }),
    prisma.businessFacts.findUnique({
      where: { projectId },
      select: { serviceArea: true },
    }),
  ]);

  const gsc = gscAgg[0];
  const hasGoogle =
    project?.gscSiteUrl !== null && project?.gscSiteUrl !== undefined;

  return {
    lastAudit:
      lastAudit?.finishedAt !== null && lastAudit?.finishedAt !== undefined
        ? {
            id: lastAudit.id,
            healthScore: lastAudit.healthScore,
            totalIssues: lastAudit.totalIssues,
            pagesCrawled: lastAudit.pagesCrawled,
            finishedAt: lastAudit.finishedAt.toISOString(),
            status: lastAudit.status,
          }
        : null,
    searchConsole:
      gsc && (gsc._sum.impressions ?? 0) > 0
        ? {
            clicks: gsc._sum.clicks ?? 0,
            impressions: gsc._sum.impressions ?? 0,
            avgPosition: Math.round((gsc._avg.position ?? 0) * 10) / 10,
          }
        : null,
    trackedKeywords,
    keywordLists,
    articles,
    setup: {
      hasGoogle,
      hasAudit: lastAudit !== null,
      hasTracking: trackedKeywords > 0,
      hasBusinessFacts: (facts?.serviceArea.trim() ?? "") !== "",
    },
  };
}
