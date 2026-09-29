import { prisma } from "@/lib/db";

export type DailyClicks = { date: string; clicks: number };

export type RankBucket = { label: string; count: number };

export type RecentActivityItem = {
  type: "search" | "article" | "audit";
  title: string;
  date: string;
};

export type StatusCount = { status: string; count: number };

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
  /** Daily clicks over the last 28 days for the traffic sparkline. */
  dailyClicks: DailyClicks[];
  /** Keyword ranking distribution buckets. */
  rankDistribution: RankBucket[];
  /** Last 5 actions across searches, articles, and audits. */
  recentActivity: RecentActivityItem[];
  /** Article counts by status for the content health donut. */
  articlesByStatus: StatusCount[];
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
    articlesCount,
    facts,
    dailyClicksRaw,
    trackedWithLatest,
    recentSearches,
    recentArticles,
    recentAudits,
    articleStatuses,
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

    // Daily clicks for sparkline (GscPageMetric grouped by date, last 28 days)
    prisma.gscPageMetric.groupBy({
      by: ["date"],
      where: { projectId, date: { gte: since } },
      _sum: { clicks: true },
      orderBy: { date: "asc" },
    }),

    // Latest rank snapshot per tracked keyword (for ranking distribution)
    prisma.trackedKeyword.findMany({
      where: { projectId, userId },
      select: {
        id: true,
        snapshots: {
          orderBy: { checkedAt: "desc" },
          take: 1,
          select: { rank: true },
        },
      },
    }),

    // Recent searches
    prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { keyword: true, updatedAt: true },
    }),

    // Recent articles
    prisma.article.findMany({
      where: { projectId, userId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { title: true, updatedAt: true },
    }),

    // Recent audits
    prisma.audit.findMany({
      where: { projectId, userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { startUrl: true, status: true, createdAt: true },
    }),

    // Articles grouped by status
    prisma.article.groupBy({
      by: ["status"],
      where: { projectId, userId },
      _count: { _all: true },
    }),
  ]);

  const gsc = gscAgg[0];
  const hasGoogle =
    project?.gscSiteUrl !== null && project?.gscSiteUrl !== undefined;

  // Build daily clicks array
  const dailyClicks: DailyClicks[] = dailyClicksRaw.map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    clicks: row._sum.clicks ?? 0,
  }));

  // Build ranking distribution buckets
  const buckets = { "1–3": 0, "4–10": 0, "11–20": 0, "21–50": 0, "50+": 0 };
  for (const tk of trackedWithLatest) {
    const rank = tk.snapshots[0]?.rank ?? null;
    if (rank === null) continue;
    if (rank <= 3) buckets["1–3"]++;
    else if (rank <= 10) buckets["4–10"]++;
    else if (rank <= 20) buckets["11–20"]++;
    else if (rank <= 50) buckets["21–50"]++;
    else buckets["50+"]++;
  }
  const rankDistribution: RankBucket[] = Object.entries(buckets).map(
    ([label, count]) => ({ label, count }),
  );

  // Merge and sort recent activity
  const recentActivity: RecentActivityItem[] = [
    ...recentSearches.map((s) => ({
      type: "search" as const,
      title: `Searched "${s.keyword}"`,
      date: s.updatedAt.toISOString(),
    })),
    ...recentArticles.map((a) => ({
      type: "article" as const,
      title: a.title || "Untitled article",
      date: a.updatedAt.toISOString(),
    })),
    ...recentAudits.map((a) => ({
      type: "audit" as const,
      title: `Audit ${a.status}: ${a.startUrl.replace(/^https?:\/\//, "")}`,
      date: a.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // Article status breakdown
  const articlesByStatus: StatusCount[] = articleStatuses.map((row) => ({
    status: row.status,
    count: row._count._all,
  }));

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
    articles: articlesCount,
    setup: {
      hasGoogle,
      hasAudit: lastAudit !== null,
      hasTracking: trackedKeywords > 0,
      hasBusinessFacts: (facts?.serviceArea.trim() ?? "") !== "",
    },
    dailyClicks,
    rankDistribution,
    recentActivity,
    articlesByStatus,
  };
}
