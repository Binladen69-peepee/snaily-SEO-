/**
 * Every read and write a Drafter job makes.
 *
 * The rule this file exists to enforce: a worker may only change a job it
 * currently holds the lease on. Every mutation therefore goes through an
 * `updateMany` whose `where` names the worker, so a function that woke up after
 * its lease expired writes nothing instead of trampling the worker that
 * replaced it. That is cheaper and far more reliable than a mutex we would
 * have nowhere to keep.
 */

import { prisma } from "@/lib/db";
import type { TokenWindowState } from "@/lib/jobs/token-window";
import {
  STAGE_LABEL,
  STAGE_NAMES,
  emptyState,
  isStageDone,
  parseState,
  type JobState,
  type JobStatus,
  type JobView,
  type StageName,
  type StageStatus,
  type StageView,
} from "@/lib/jobs/types";

/** How long a claim is good for. Long enough to outlive one invocation. */
export const LEASE_MS = 90_000;

/**
 * Content hash for duplicate-commit detection.
 *
 * FNV-1a rather than a real digest: this is only ever compared against another
 * hash produced here, never trusted as a security boundary, and it avoids
 * pulling a node-only crypto import into a route that the bundler may decide
 * to run somewhere else.
 */
export function outputHash(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, "0")}-${String(text.length)}`;
}

export type JobRecord = {
  id: string;
  userId: string;
  projectId: string;
  articleId: string;
  status: JobStatus;
  stage: string;
  state: JobState;
  errorCode: string | null;
  errorMessage: string | null;
  workerId: string;
  leaseExpiresAt: Date | null;
  cancelRequested: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** The provider's rolling per-minute allowance, carried between workers. */
  tokenWindow: TokenWindowState;
};

const JOB_SELECT = {
  id: true,
  userId: true,
  projectId: true,
  articleId: true,
  status: true,
  stage: true,
  state: true,
  errorCode: true,
  errorMessage: true,
  workerId: true,
  leaseExpiresAt: true,
  cancelRequested: true,
  startedAt: true,
  finishedAt: true,
  tpmWindowStart: true,
  tpmWindowTokens: true,
} as const;

type RawJob = {
  id: string;
  userId: string;
  projectId: string;
  articleId: string;
  status: string;
  stage: string;
  state: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  workerId: string;
  leaseExpiresAt: Date | null;
  cancelRequested: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  tpmWindowStart: Date | null;
  tpmWindowTokens: number;
};

function toRecord(row: RawJob): JobRecord {
  return {
    ...row,
    status: row.status as JobStatus,
    state: parseState(row.state),
    tokenWindow: {
      startedAt: row.tpmWindowStart,
      tokens: row.tpmWindowTokens,
    },
  };
}

/**
 * The job for this article, creating one only if none is already live.
 *
 * Idempotent on purpose. Double-clicking Draft Article, or a retried POST after
 * a dropped response, must not start a second generation against the same
 * article — two workers writing one draft is the one race that produces
 * garbage nobody can untangle afterwards.
 */
export async function createOrResumeJob(input: {
  userId: string;
  projectId: string;
  articleId: string;
}): Promise<{ job: JobRecord; created: boolean }> {
  const live = await prisma.draftJob.findFirst({
    where: {
      articleId: input.articleId,
      status: { in: ["queued", "running", "paused", "retrying"] },
    },
    orderBy: { createdAt: "desc" },
    select: JOB_SELECT,
  });

  if (live !== null) return { job: toRecord(live), created: false };

  const job = await prisma.draftJob.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      articleId: input.articleId,
      status: "queued",
      state: emptyState(),
      stages: {
        create: STAGE_NAMES.map((name, i) => ({ name, ordinal: i })),
      },
    },
    select: JOB_SELECT,
  });

  return { job: toRecord(job), created: true };
}

export async function findJob(jobId: string): Promise<JobRecord | null> {
  const row = await prisma.draftJob.findUnique({
    where: { id: jobId },
    select: JOB_SELECT,
  });
  return row === null ? null : toRecord(row);
}

/** The job a given user is allowed to see. Ownership is never assumed. */
export async function findOwnedJob(
  jobId: string,
  userId: string,
): Promise<JobRecord | null> {
  const row = await prisma.draftJob.findFirst({
    where: { id: jobId, userId },
    select: JOB_SELECT,
  });
  return row === null ? null : toRecord(row);
}

export async function latestJobForArticle(
  articleId: string,
  userId: string,
): Promise<JobRecord | null> {
  const row = await prisma.draftJob.findFirst({
    where: { articleId, userId },
    orderBy: { createdAt: "desc" },
    select: JOB_SELECT,
  });
  return row === null ? null : toRecord(row);
}

/**
 * Takes the lease, or reports that someone else holds it.
 *
 * The `where` is the whole mechanism: Postgres serialises the two updates, and
 * the loser re-evaluates the predicate against the winner's committed row and
 * matches nothing. No advisory locks, no extra round trip.
 */
export async function claimJob(
  jobId: string,
  workerId: string,
): Promise<JobRecord | null> {
  const now = new Date();
  const claimed = await prisma.draftJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["queued", "running", "retrying", "paused"] },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: now } },
        { workerId },
      ],
    },
    data: {
      status: "running",
      workerId,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      startedAt: undefined,
    },
  });

  if (claimed.count === 0) return null;

  await prisma.draftJob.updateMany({
    where: { id: jobId, workerId, startedAt: null },
    data: { startedAt: now },
  });

  return findJob(jobId);
}

export async function renewLease(jobId: string, workerId: string): Promise<boolean> {
  const res = await prisma.draftJob.updateMany({
    where: { id: jobId, workerId },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  return res.count === 1;
}

/** Hands the job back so the next invocation can pick it up immediately. */
export async function releaseLease(
  jobId: string,
  workerId: string,
  status: JobStatus,
): Promise<void> {
  await prisma.draftJob.updateMany({
    where: { id: jobId, workerId },
    data: {
      status,
      workerId: "",
      claimedAt: null,
      leaseExpiresAt: null,
    },
  });
}

export async function saveState(
  jobId: string,
  workerId: string,
  state: JobState,
): Promise<void> {
  await prisma.draftJob.updateMany({
    where: { id: jobId, workerId },
    data: { state },
  });
}

/**
 * Records what the job has spent this minute.
 *
 * Written before each call rather than after, so a worker that dies mid-request
 * still leaves the spend behind it. Guarded by the lease like every other
 * write: a worker that has lost the job must not be able to reset a window its
 * successor is relying on.
 */
export async function saveTokenWindow(
  jobId: string,
  workerId: string,
  window: TokenWindowState,
): Promise<void> {
  await prisma.draftJob.updateMany({
    where: { id: jobId, workerId },
    data: {
      tpmWindowStart: window.startedAt,
      tpmWindowTokens: window.tokens,
    },
  });
}

export async function setStage(
  jobId: string,
  workerId: string,
  stage: StageName,
): Promise<void> {
  await prisma.draftJob.updateMany({
    where: { id: jobId, workerId },
    data: { stage },
  });
}

export async function finishJob(
  jobId: string,
  workerId: string,
  status: Extract<JobStatus, "completed" | "failed" | "cancelled">,
  error?: { code: string; message: string },
): Promise<void> {
  await prisma.draftJob.updateMany({
    where: { id: jobId, workerId },
    data: {
      status,
      stage: "",
      workerId: "",
      claimedAt: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
    },
  });
}

export async function requestCancel(jobId: string, userId: string): Promise<boolean> {
  const res = await prisma.draftJob.updateMany({
    where: { id: jobId, userId, status: { in: ["queued", "running", "paused", "retrying"] } },
    data: { cancelRequested: true },
  });
  return res.count === 1;
}

export type StageRecord = {
  id: string;
  name: StageName;
  ordinal: number;
  status: StageStatus;
  attempt: number;
  output: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
};

const STAGE_SELECT = {
  id: true,
  name: true,
  ordinal: true,
  status: true,
  attempt: true,
  output: true,
  errorCode: true,
  errorMessage: true,
  durationMs: true,
} as const;

export async function loadStages(jobId: string): Promise<StageRecord[]> {
  const rows = await prisma.draftJobStage.findMany({
    where: { draftJobId: jobId },
    orderBy: { ordinal: "asc" },
    select: STAGE_SELECT,
  });
  return rows.map((r) => ({
    ...r,
    name: r.name as StageName,
    status: r.status as StageStatus,
  }));
}

/** Marker a stage leaves behind when it ran out of time mid-flight. */
type PartialMarker = { partial: true; note: string };

function isPartial(output: unknown): output is PartialMarker {
  return (
    output !== null &&
    typeof output === "object" &&
    (output as PartialMarker).partial === true
  );
}

/**
 * Marks a stage as being worked on and bumps its attempt counter.
 *
 * Returns `started: false` when the stage is already finished, which is the
 * idempotency check that matters: a retry arriving after the original
 * committed finds `completed` here and the runner moves straight on instead of
 * paying for the same section twice.
 *
 * A stage that yielded on purpose is resumed rather than re-attempted. Without
 * that distinction a five-call section stage spanning three invocations would
 * look like three failed attempts and exhaust its retry budget having never
 * actually failed.
 */
export async function beginStage(
  jobId: string,
  name: StageName,
): Promise<{ started: boolean; attempt: number; resumed: boolean }> {
  const existing = await prisma.draftJobStage.findUnique({
    where: { draftJobId_name: { draftJobId: jobId, name } },
    select: { status: true, attempt: true, output: true },
  });

  if (existing !== null && isStageDone(existing.status as StageStatus)) {
    return { started: false, attempt: existing.attempt, resumed: false };
  }

  const resumed = existing?.status === "running" && isPartial(existing.output);
  const attempt = resumed ? existing.attempt : (existing?.attempt ?? 0) + 1;
  const ordinal = Math.max(0, STAGE_NAMES.indexOf(name));

  /*
   * Upsert rather than update: a job created before a stage was added to
   * STAGE_NAMES has no row for it, and update() would throw mid-pipeline.
   */
  await prisma.draftJobStage.upsert({
    where: { draftJobId_name: { draftJobId: jobId, name } },
    create: {
      draftJobId: jobId,
      name,
      ordinal,
      status: "running",
      attempt,
      startedAt: new Date(),
    },
    update: {
      status: "running",
      attempt,
      startedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });

  return { started: true, attempt, resumed };
}

/** Records that a stage stopped on purpose, with the progress note for the UI. */
export async function markStagePartial(
  jobId: string,
  name: StageName,
  note: string,
): Promise<void> {
  await prisma.draftJobStage.updateMany({
    where: { draftJobId: jobId, name, status: "running" },
    data: { output: { partial: true, note } },
  });
}

/** The progress note a running stage last left, e.g. "3/5". */
export function partialNote(output: unknown): string {
  return isPartial(output) ? output.note : "";
}

/**
 * Books one model call against the stage that made it, as it happens.
 *
 * Written per call rather than totalled at commit time. A stage that spans four
 * invocations — which the section writer always does — only ever had the last
 * invocation's tally in memory when it committed, so the recorded cost of an
 * article was whatever the final worker happened to spend. That understated a
 * real run by roughly half, and a cost figure that is quietly wrong is worse
 * than no cost figure at all, because somebody will quote it.
 */
export async function recordAiCall(
  jobId: string,
  name: StageName,
  usage: { input: number; output: number; provider: string; model: string },
): Promise<void> {
  await prisma.$transaction([
    prisma.draftJobStage.updateMany({
      where: { draftJobId: jobId, name },
      data: {
        inputTokens: { increment: usage.input },
        outputTokens: { increment: usage.output },
        provider: usage.provider,
        model: usage.model,
      },
    }),
    prisma.draftJob.update({
      where: { id: jobId },
      data: {
        aiCalls: { increment: 1 },
        inputTokens: { increment: usage.input },
        outputTokens: { increment: usage.output },
      },
    }),
  ]);
}

/**
 * Commits a stage exactly once.
 *
 * The guard is `status: "running"`: a second worker that finished the same
 * stage concurrently finds the row already `completed` and its update matches
 * nothing, so the first result stands rather than the last one to arrive. The
 * hash is stored so a duplicate commit is visible in the diagnostics instead of
 * merely being prevented.
 *
 * Token counts are not written here — `recordAiCall` has been adding them all
 * along, one call at a time, so they survive a stage that took four invocations
 * to finish.
 */
export async function commitStage(
  jobId: string,
  name: StageName,
  output: unknown,
  durationMs: number,
): Promise<boolean> {
  const res = await prisma.draftJobStage.updateMany({
    where: { draftJobId: jobId, name, status: "running" },
    data: {
      status: "completed",
      completedAt: new Date(),
      output: output === undefined ? undefined : (output as never),
      outputHash: outputHash(output),
      durationMs: { increment: durationMs },
    },
  });

  return res.count === 1;
}

export async function skipStage(
  jobId: string,
  name: StageName,
  reason: string,
): Promise<void> {
  await prisma.draftJobStage.updateMany({
    where: { draftJobId: jobId, name, status: { in: ["running", "pending"] } },
    data: {
      status: "skipped",
      completedAt: new Date(),
      errorMessage: reason,
    },
  });
}

export async function failStage(
  jobId: string,
  name: StageName,
  code: string,
  message: string,
  durationMs: number,
): Promise<void> {
  await prisma.draftJobStage.updateMany({
    where: { draftJobId: jobId, name },
    data: { status: "failed", errorCode: code, errorMessage: message, durationMs },
  });
}

/** Puts one failed stage back in the queue without touching the ones before it. */
export async function resetStage(jobId: string, name: StageName): Promise<void> {
  await prisma.draftJobStage.updateMany({
    where: { draftJobId: jobId, name },
    data: { status: "pending", errorCode: null, errorMessage: null },
  });
}

/**
 * Jobs whose worker died.
 *
 * A lease that expired without the job finishing means the function was
 * killed - a deploy, a timeout, a crash. Nothing else notices, so a sweeper
 * has to.
 *
 * Scoped to one user when a `userId` is given, which is how the article list
 * can safely restart the caller's own stalled work without becoming an
 * endpoint that touches other people's jobs.
 */
export async function staleJobs(limit = 5, userId?: string): Promise<string[]> {
  const rows = await prisma.draftJob.findMany({
    where: {
      status: { in: ["queued", "running", "retrying"] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
      ...(userId === undefined ? {} : { userId }),
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** What the browser is allowed to see. No prompts, tokens, or provider text. */
export function toJobView(
  job: JobRecord,
  stages: StageRecord[],
  detail: (name: StageName) => string,
): JobView {
  const byName = new Map(stages.map((s) => [s.name, s]));
  const views: StageView[] = STAGE_NAMES.map((name) => {
    const s = byName.get(name);
    if (s === undefined) {
      return {
        name,
        label: STAGE_LABEL[name],
        status: "pending",
        attempt: 0,
        detail: "",
        errorMessage: null,
        durationMs: 0,
      };
    }
    return {
      name,
      label: STAGE_LABEL[name],
      status: s.status,
      attempt: s.attempt,
      detail: s.status === "running" ? detail(name) : "",
      errorMessage: s.status === "failed" ? s.errorMessage : null,
      durationMs: s.durationMs,
    };
  });

  const failed = views.find((s) => s.status === "failed");

  return {
    id: job.id,
    articleId: job.articleId,
    status: job.status,
    stage: (job.stage as StageName) || "",
    stages: views,
    done: views.filter((s) => isStageDone(s.status)).length,
    total: views.length,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    failedStage: failed?.name ?? null,
    words: job.state.words ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}
