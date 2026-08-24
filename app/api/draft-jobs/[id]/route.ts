import { after, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isValidId } from "@/lib/db";
import { kickRunner, selfOrigin } from "@/lib/jobs/kick";
import {
  findOwnedJob,
  loadStages,
  partialNote,
  toJobView,
} from "@/lib/jobs/store";
import { isTerminal, type StageName } from "@/lib/jobs/types";

export const maxDuration = 30;

/**
 * Live job status for the progress panel.
 *
 * Doubles as the recovery path. A job whose lease has expired without
 * finishing has lost its worker — a timeout, a deploy, a crash — and the
 * browser asking "how is it going" is the most reliable signal available that
 * somebody still wants the answer. So the poll restarts it. That is why closing
 * the tab and coming back works: the first poll on the reopened page picks the
 * job up where it stopped.
 */
export async function GET(
  req: Request,
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

  const stages = await loadStages(id);
  const notes = new Map<StageName, string>(
    stages.map((s) => [s.name, partialNote(s.output)]),
  );

  const view = toJobView(job, stages, (name) => notes.get(name) ?? "");

  const stalled =
    !isTerminal(job.status) &&
    (job.leaseExpiresAt === null || job.leaseExpiresAt.getTime() < Date.now());

  if (stalled) {
    const origin = selfOrigin(req);
    after(async () => {
      await kickRunner(id, origin);
    });
  }

  return NextResponse.json({ job: view, resuming: stalled });
}
