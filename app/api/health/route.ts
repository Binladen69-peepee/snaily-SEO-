import { NextResponse } from "next/server";

import { dataForSeoConfigured } from "@/lib/dataforseo/config";
import { prisma } from "@/lib/db";

/**
 * Liveness for uptime checks. No secrets. Does not spend provider quota.
 */
export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }

  const ok = db;
  return NextResponse.json(
    {
      ok,
      db,
      dataforseo: dataForSeoConfigured(),
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
