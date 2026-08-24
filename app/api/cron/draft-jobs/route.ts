import { NextResponse } from "next/server";

import { kickRunner, selfOrigin } from "@/lib/jobs/kick";
import { staleJobs } from "@/lib/jobs/store";

export const maxDuration = 60;

/**
 * Picks up jobs nobody is watching.
 *
 * The chain and the browser poll between them cover every case where something
 * is still running or somebody still has the page open. This covers the last
 * one: the author clicked Draft Article, closed the laptop, and the invocation
 * that was mid-flight died on a deploy. Their draft finishes anyway.
 *
 * A stale lease is the signal — a job in a working state whose worker has not
 * renewed. Reclaiming is the same code path as any other kick, so there is no
 * separate recovery logic to keep correct.
 */
export async function GET(req: Request) {
  const configured = (process.env.CRON_SECRET ?? "").trim();

  /*
   * Vercel signs its own cron requests with CRON_SECRET as a bearer token. When
   * no secret is configured the endpoint refuses rather than running open: it
   * can start paid work, so an unauthenticated caller must never reach it.
   */
  if (configured === "") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  if (req.headers.get("authorization") !== `Bearer ${configured}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ids = await staleJobs(5);
  const origin = selfOrigin(req);

  for (const id of ids) {
    await kickRunner(id, origin);
  }

  return NextResponse.json({ resumed: ids.length });
}
