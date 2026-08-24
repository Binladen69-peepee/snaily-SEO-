import { after, NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { kickRunner, selfOrigin } from "@/lib/jobs/kick";
import { findOwnedJob, loadStages, resetStage } from "@/lib/jobs/store";
import { STAGE_NAMES, type StageName } from "@/lib/jobs/types";

export const maxDuration = 30;

const schema = z.object({
  stage: z.enum(STAGE_NAMES).optional(),
});

/**
 * Retries one stage, or reopens a stopped job, keeping everything before it.
 *
 * The point of the whole design in one endpoint: "we couldn't finish Serving
 * Ideas" should cost one section, not an article. The failed stage goes back to
 * pending, its attempt counter is cleared so it gets a full retry budget again,
 * and the job is woken. Completed stages are not touched, so nothing already
 * written is regenerated or paid for twice.
 *
 * With no failed stage it is a resume: a job somebody stopped, or one that
 * failed on a stage that has since been repaired, picks up at the first stage
 * that is not finished. Starting a fresh job instead would re-pay for every
 * section already written, which is the wrong answer to "carry on".
 */
export async function POST(
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

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
  }

  const stages = await loadStages(id);
  const target: StageName | undefined =
    parsed.data.stage ?? stages.find((s) => s.status === "failed")?.name;

  const unfinished = stages.filter(
    (s) => s.status !== "completed" && s.status !== "skipped",
  );
  if (target === undefined && unfinished.length === 0) {
    return NextResponse.json(
      { error: "This article is already finished." },
      { status: 400 },
    );
  }

  if (target !== undefined) {
    await resetStage(id, target);
    await prisma.draftJobStage.updateMany({
      where: { draftJobId: id, name: target },
      data: { attempt: 0 },
    });
  }

  await prisma.draftJob.updateMany({
    where: { id, userId: session.userId },
    data: {
      status: "queued",
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      cancelRequested: false,
      workerId: "",
      claimedAt: null,
      leaseExpiresAt: null,
    },
  });

  const origin = selfOrigin(req);
  after(async () => {
    await kickRunner(id, origin);
  });

  return NextResponse.json({
    retrying: target ?? unfinished[0]?.name ?? null,
    resumed: target === undefined,
  });
}
