import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { findOwnedJob } from "@/lib/jobs/store";
import { STAGE_LABEL, type StageName } from "@/lib/jobs/types";

export const maxDuration = 20;

/**
 * What one article actually cost.
 *
 * Token counts come from the provider's own `usage` field wherever it sent one,
 * and are marked as estimated where it did not. No price is calculated here:
 * a per-token rate this app has no way to verify would produce a number that
 * looks like a bill and is not one, and the client would reasonably treat it as
 * a bill. Tokens are a fact; dollars are the provider's to state.
 */
export async function GET(
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

  const totals = await prisma.draftJob.findUnique({
    where: { id },
    select: {
      aiCalls: true,
      inputTokens: true,
      outputTokens: true,
      startedAt: true,
      finishedAt: true,
    },
  });

  const stages = await prisma.draftJobStage.findMany({
    where: { draftJobId: id },
    orderBy: { ordinal: "asc" },
    select: {
      name: true,
      status: true,
      attempt: true,
      durationMs: true,
      inputTokens: true,
      outputTokens: true,
      provider: true,
      model: true,
      outputHash: true,
      errorCode: true,
      errorMessage: true,
    },
  });

  return NextResponse.json({
    job: {
      id,
      aiCalls: totals?.aiCalls ?? 0,
      inputTokens: totals?.inputTokens ?? 0,
      outputTokens: totals?.outputTokens ?? 0,
      totalTokens: (totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0),
      retries: stages.reduce((sum, s) => sum + Math.max(0, s.attempt - 1), 0),
      elapsedMs:
        totals?.startedAt != null && totals.finishedAt != null
          ? totals.finishedAt.getTime() - totals.startedAt.getTime()
          : null,
    },
    words: job.state.words ?? null,
    links: job.state.links ?? null,
    style: job.state.style ?? [],
    quality: job.state.quality ?? null,
    provenance: job.state.research?.provenance ?? [],
    stages: stages.map((s) => ({
      ...s,
      label: STAGE_LABEL[s.name as StageName] ?? s.name,
    })),
  });
}
