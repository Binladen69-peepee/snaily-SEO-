import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { runHealthChecks } from "@/lib/settings-health";
import { ensureSettings } from "@/lib/settings";
import { isOwner } from "@/lib/users";

/** Four external probes in parallel, each with its own 10s ceiling. */
export const maxDuration = 30;

/** Key health is owner-only, same as the keys themselves. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(await isOwner(session.userId))) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }

  const force = new URL(req.url).searchParams.get("refresh") === "1";
  await ensureSettings();
  return NextResponse.json({ checks: await runHealthChecks(force) });
}
