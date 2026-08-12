import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Fail faster with a clear error instead of hanging forever.
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Cuid / uuid-style ids — replaces mongoose.isValidObjectId. */
export function isValidId(id: string): boolean {
  return typeof id === "string" && /^[a-z0-9_-]{20,36}$/i.test(id);
}
