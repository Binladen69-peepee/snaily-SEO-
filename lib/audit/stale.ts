import { prisma } from "@/lib/db";

/** Audits stuck in `running` longer than this are marked failed. */
const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Marks abandoned crawls as failed so a new audit can start.
 *
 * A server restart or an unhandled error can leave `status: running` forever;
 * without this sweep the project is blocked from re-crawling.
 */
export async function expireStaleAudits(projectId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_MS);

  const stale = await prisma.audit.findMany({
    where: {
      status: "running",
      startedAt: { lt: cutoff },
      ...(projectId ? { projectId } : {}),
    },
    select: { id: true },
  });

  if (stale.length === 0) return 0;

  await prisma.audit.updateMany({
    where: { id: { in: stale.map((a) => a.id) } },
    data: {
      status: "failed",
      error: "The crawl timed out or was interrupted. Run a new audit.",
      finishedAt: new Date(),
    },
  });

  return stale.length;
}
