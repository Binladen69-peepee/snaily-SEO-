import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId } from "@/lib/db";
import { originOf } from "@/lib/google/oauth";
import { runSync } from "@/lib/google/sync";
import { ensureSettings } from "@/lib/settings";

/** Ninety days of Search Console and GA4 rows takes a while to pull. */
export const maxDuration = 60;

const schema = z.object({ projectId: z.string().min(1) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success || !isValidId(parsed.data.projectId)) {
    return NextResponse.json({ error: "Project required" }, { status: 400 });
  }

  try {
    await ensureSettings();
    const result = await runSync(
      session.userId,
      parsed.data.projectId,
      originOf(req),
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 502 },
    );
  }
}
