import { after, NextResponse } from "next/server";

import { kickRunner, selfOrigin, verifyJobToken } from "@/lib/jobs/kick";
import { runJob } from "@/lib/jobs/runner";
import { findJob } from "@/lib/jobs/store";
import { isValidId } from "@/lib/db";

/** One worker invocation. The job itself spans as many as it needs. */
export const maxDuration = 60;

/**
 * Runs a slice of a generation job.
 *
 * Answers immediately and does the work in `after()`. That is not a style
 * choice: the caller is another server invocation, and if it had to hold the
 * connection open for the whole slice, a client-side abort could take the
 * worker down with it. Responding first makes the two invocations genuinely
 * independent, which is the property the whole design rests on.
 *
 * Authorised by a per-job token rather than a session, because the callers are
 * `after()` from another function and the cron sweeper, neither of which has a
 * cookie. The token names one job and can do nothing else with it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = req.headers.get("x-job-token") ?? "";
  if (!(await verifyJobToken(id, token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await findJob(id);
  if (job === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const origin = selfOrigin(req);

  after(async () => {
    const outcome = await runJob(id);
    if (outcome.chain) {
      await kickRunner(id, origin, outcome.delayMs);
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
