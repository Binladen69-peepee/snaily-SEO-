import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type HistoryItem = {
  id: string;
  keyword: string;
  country: string;
  resultCount: number;
  searchCount: number;
  searchedAt: string;
};

export async function recordSearch(
  keyword: string,
  country: string,
  resultCount: number,
) {
  const session = await getSession();
  if (!session) return;

  const key = keyword.trim().toLowerCase();

  await prisma.searchHistory.upsert({
    where: {
      userId_keyword_country: {
        userId: session.userId,
        keyword: key,
        country,
      },
    },
    create: {
      userId: session.userId,
      keyword: key,
      country,
      resultCount,
      searchCount: 1,
    },
    update: {
      resultCount,
      searchCount: { increment: 1 },
    },
  });
}

export async function getHistory(limit = 15): Promise<HistoryItem[]> {
  const session = await getSession();
  if (!session) return [];

  const docs = await prisma.searchHistory.findMany({
    where: { userId: session.userId },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return docs.map((d) => ({
    id: d.id,
    keyword: d.keyword,
    country: d.country,
    resultCount: d.resultCount,
    searchCount: d.searchCount,
    searchedAt: d.updatedAt.toISOString(),
  }));
}
