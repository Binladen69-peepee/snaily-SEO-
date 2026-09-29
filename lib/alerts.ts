import { classifyRankMovement, type RankAlertRow } from "@/lib/alerts-logic";
import { prisma } from "@/lib/db";

export { alertCopy, type RankAlertRow } from "@/lib/alerts-logic";

/**
 * After a rank check, open an alert when a keyword dropped 5+ places or
 * left the results entirely. Gains of 5+ are recorded too so the dashboard
 * is not only bad news.
 */
export async function recordRankMovement(input: {
  projectId: string;
  userId: string;
  keywordId: string;
  keyword: string;
  previousRank: number | null;
  currentRank: number | null;
}): Promise<void> {
  const kind = classifyRankMovement(input.previousRank, input.currentRank);
  if (kind === null) return;
  const { previousRank: prev, currentRank: next } = input;

  try {
    await prisma.rankAlert.create({
      data: {
        projectId: input.projectId,
        userId: input.userId,
        keywordId: input.keywordId,
        keyword: input.keyword,
        kind,
        previousRank: prev,
        currentRank: next,
      },
    });
  } catch {
    /* ignore */
  }
}

export async function listOpenAlerts(
  projectId: string,
  limit = 8,
): Promise<RankAlertRow[]> {
  try {
    const rows = await prisma.rankAlert.findMany({
      where: { projectId, readAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      kind: r.kind,
      previousRank: r.previousRank,
      currentRank: r.currentRank,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}
