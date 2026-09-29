import { prisma } from "@/lib/db";
import type { RateLimitResult } from "@/lib/security/rate-limit";
import { rateLimit as memoryLimit } from "@/lib/security/rate-limit";

/**
 * Durable rate limit. Memory is the fast path; Postgres is the source of
 * truth across Vercel isolates. If the table is missing, memory still works.
 */
export async function rateLimitDurable(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const mem = memoryLimit(key, limit, windowMs);
  if (!mem.ok) return mem;

  const now = Date.now();
  try {
    const row = await prisma.rateLimitBucket.findUnique({ where: { key } });
    if (!row || row.resetAt.getTime() <= now) {
      await prisma.rateLimitBucket.upsert({
        where: { key },
        create: {
          key,
          count: 1,
          resetAt: new Date(now + windowMs),
        },
        update: { count: 1, resetAt: new Date(now + windowMs) },
      });
      return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
    }

    const next = row.count + 1;
    await prisma.rateLimitBucket.update({
      where: { key },
      data: { count: next },
    });
    const retryAfterSec = Math.max(
      1,
      Math.ceil((row.resetAt.getTime() - now) / 1000),
    );
    if (next > limit) {
      return { ok: false, remaining: 0, retryAfterSec };
    }
    return { ok: true, remaining: Math.max(0, limit - next), retryAfterSec: 0 };
  } catch {
    return mem;
  }
}
