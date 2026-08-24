import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isValidId } from "@/lib/db";
import { findOwnedJob, requestCancel } from "@/lib/jobs/store";

export const maxDuration = 15;

/**
 * Asks a running job to stop.
 *
 * Cooperative rather than immediate: the flag is set, and the worker checks it
 * at the next stage boundary. Killing a stage mid-call would not refund the
 * tokens already spent and would leave a half-written section that the resume
 * path cannot tell apart from a finished one. Everything generated up to the
 * stop is kept.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const job = await findOwnedJob(id, session.userId);
  if (job === null) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const ok = await requestCancel(id, session.userId);
  return NextResponse.json({
    cancelled: ok,
    message: ok
      ? "Stopping after the current step. Everything written so far is kept."
      : "This job has already finished.",
  });
}
