import { prisma } from "@/lib/db";
import { similarity } from "@/lib/geo/redundancy";

export type CannibalGroup = {
  pages: { path: string; url: string; title: string }[];
  reason: string;
};

/**
 * Finds pages from the latest audit that compete for the same topic.
 *
 * Uses title similarity — the same signal as GEO Lab redundancy. Real
 * cannibalization from Search Console would need query+page dimensions;
 * this is the best signal available without a schema change.
 */
export async function findCannibalization(
  userId: string,
  projectId: string,
): Promise<CannibalGroup[]> {
  const audit = await prisma.audit.findFirst({
    where: { userId, projectId, status: "completed" },
    orderBy: { finishedAt: "desc" },
    select: { id: true },
  });
  if (!audit) return [];

  const pages = await prisma.auditPage.findMany({
    where: { auditId: audit.id, status: { lt: 400 } },
    select: { url: true, path: true, title: true },
    orderBy: { path: "asc" },
  });

  const groups: CannibalGroup[] = [];
  const used = new Set<string>();

  for (let i = 0; i < pages.length; i++) {
    const a = pages[i]!;
    if (a.title.trim() === "" || used.has(a.url)) continue;

    const cluster = [a];
    for (let j = i + 1; j < pages.length; j++) {
      const b = pages[j]!;
      if (b.title.trim() === "" || used.has(b.url)) continue;

      const sameTitle = a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
      const similar = similarity(a.title, b.title) >= 0.6;

      if (sameTitle || similar) cluster.push(b);
    }

    if (cluster.length < 2) continue;

    for (const p of cluster) used.add(p.url);

    const exact = cluster.every(
      (p) => p.title.trim().toLowerCase() === cluster[0]!.title.trim().toLowerCase(),
    );

    groups.push({
      pages: cluster.map((p) => ({ path: p.path, url: p.url, title: p.title })),
      reason: exact
        ? "Identical title tags — Google may struggle to pick one page to rank."
        : "Very similar titles — these pages likely target the same query.",
    });
  }

  return groups.sort((a, b) => b.pages.length - a.pages.length);
}
