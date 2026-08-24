/**
 * The orchestrator.
 *
 * One invocation of `runJob` claims a job, works through as many stages as it
 * can fit inside its wall-clock budget and its share of the provider's
 * per-minute allowance, then hands the job back. It is written to be
 * interrupted: nothing it does depends on the function still being alive a
 * second later, because every result is committed the moment it exists.
 *
 * That is the whole reason the pipeline is staged. A serverless function has
 * sixty seconds and an article takes several minutes, so the question is never
 * "how do we make the request last longer" — it is "what does the next
 * invocation need to know to carry on", and the answer is a row.
 */

import { retryLimit } from "@/lib/ai-policy";
import { prisma } from "@/lib/db";
import {
  StageFailure,
  TokenWindowExhausted,
  makeAi,
  makeOutOfTime,
  type StageContext,
  type StageCostTally,
} from "@/lib/jobs/context";
import { STAGES } from "@/lib/jobs/stages";
import {
  beginStage,
  claimJob,
  commitStage,
  failStage,
  finishJob,
  loadStages,
  markStagePartial,
  recordAiCall,
  releaseLease,
  renewLease,
  saveState,
  saveTokenWindow,
  setStage,
  skipStage,
  type JobRecord,
} from "@/lib/jobs/store";
import { TokenWindow } from "@/lib/jobs/token-window";
import {
  STAGE_NAMES,
  isStageDone,
  type JobState,
  type StageName,
} from "@/lib/jobs/types";

/**
 * How long one invocation works before yielding.
 *
 * The route declares `maxDuration = 60`. Fifteen seconds of that is kept back
 * for the stage already mid-flight when the budget runs out, plus the writes
 * that follow it — a worker killed while committing is the one way this design
 * can lose work, so it is bought out with time rather than guarded against with
 * cleverness.
 */
const RUN_BUDGET_MS = 45_000;

/** Retry spacing when a provider asks us to wait, doubling each attempt. */
function backoffMs(attempt: number, hint: number): number {
  const base = hint > 0 ? hint : 2_000;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), 30_000);
}

export type RunOutcome = {
  jobId: string;
  status: JobRecord["status"];
  /** True when the job needs another invocation to continue. */
  chain: boolean;
  /** How long the next invocation should wait before claiming. */
  delayMs: number;
  stagesRun: number;
  reason: string;
};

export function newWorkerId(): string {
  const host = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.HOSTNAME ?? "local";
  return `${host.slice(0, 24)}:${Math.random().toString(36).slice(2, 10)}`;
}

/** Structured log line. Content, prompts and credentials never appear here. */
function logger(jobId: string) {
  return (event: string, data: Record<string, string | number | boolean> = {}) => {
    console.log(JSON.stringify({ scope: "draft-job", jobId, event, ...data }));
  };
}

export async function runJob(
  jobId: string,
  workerId = newWorkerId(),
  budgetMs = RUN_BUDGET_MS,
): Promise<RunOutcome> {
  const log = logger(jobId);
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;

  const job = await claimJob(jobId, workerId);
  if (job === null) {
    log("claim_declined");
    return {
      jobId,
      status: "running",
      chain: false,
      delayMs: 0,
      stagesRun: 0,
      reason: "another worker holds this job",
    };
  }

  const article = await prisma.article.findUnique({
    where: { id: job.articleId },
    select: {
      id: true,
      projectId: true,
      userId: true,
      title: true,
      keyword: true,
      country: true,
      recipe: true,
      content: true,
    },
  });

  if (article === null) {
    await finishJob(jobId, workerId, "failed", {
      code: "article_gone",
      message: "The article was deleted.",
    });
    return {
      jobId,
      status: "failed",
      chain: false,
      delayMs: 0,
      stagesRun: 0,
      reason: "article gone",
    };
  }

  const state = job.state;
  const window = new TokenWindow(job.tokenWindow);
  let stagesRun = 0;

  /*
   * An index rather than a for-of, because a retryable failure has to re-run
   * the stage it just failed. The first version used `continue` inside the
   * catch, which moved on to the *next* stage instead — so a section that hit a
   * rate limit was silently never written, and the pipeline carried on
   * assembling an article around the hole. Retrying the current stage has to be
   * expressible, so the cursor is explicit.
   */
  for (let i = 0; i < STAGE_NAMES.length; i += 1) {
    const name = STAGE_NAMES[i]!;

    const stages = await loadStages(jobId);
    const row = stages.find((s) => s.name === name);
    if (row !== undefined && isStageDone(row.status)) continue;

    /*
     * Cancellation is checked between stages rather than inside them. A stage
     * halfway through a model call is going to finish that call either way —
     * the tokens are already spent — so stopping cleanly at the boundary costs
     * nothing and leaves the job in a state somebody can resume.
     */
    const fresh = await prisma.draftJob.findUnique({
      where: { id: jobId },
      select: { cancelRequested: true },
    });
    if (fresh?.cancelRequested === true) {
      await saveState(jobId, workerId, state);
      await finishJob(jobId, workerId, "cancelled");
      log("cancelled", { stage: name });
      return {
        jobId,
        status: "cancelled",
        chain: false,
        delayMs: 0,
        stagesRun,
        reason: "cancelled",
      };
    }

    if (Date.now() >= deadline) {
      await yieldJob(jobId, workerId, state, window);
      log("yield_budget", { stage: name, stagesRun });
      return {
        jobId,
        status: "running",
        chain: true,
        delayMs: 0,
        stagesRun,
        reason: "budget",
      };
    }

    const begun = await beginStage(jobId, name);
    if (!begun.started) continue;

    await setStage(jobId, workerId, name);
    await renewLease(jobId, workerId);

    const cost: StageCostTally = {
      aiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      provider: "",
      model: "",
      measured: true,
    };

    const ctx: StageContext = {
      jobId,
      stage: name,
      article,
      state,
      deadline,
      cost,
      log: (event, data) => {
        log(event, { stage: name, attempt: begun.attempt, ...data });
      },
      ai: makeAi({
        stage: name,
        cost,
        log,
        attempt: begun.attempt,
        window,
        /*
         * Spend is persisted before the call, not after. A function killed
         * mid-request still spent those tokens, and the worker that replaces it
         * has to know, or it will spend them again inside the same minute and
         * collect the 429 this whole mechanism exists to avoid.
         */
        onSpend: async () => {
          await saveTokenWindow(jobId, workerId, window.toState());
        },
        onCall: async (usage) => {
          await recordAiCall(jobId, name, usage);
        },
      }),
      tokensLeft: () => window.remaining(),
      outOfTime: makeOutOfTime(deadline),
    };

    const stageStart = Date.now();

    try {
      const result = await STAGES[name](ctx);
      const durationMs = Date.now() - stageStart;

      if (result.kind === "partial") {
        await saveState(jobId, workerId, state);
        await markStagePartial(jobId, name, result.note);
        await yieldJob(jobId, workerId, state, window);
        log("stage_partial", { stage: name, note: result.note, durationMs });
        return {
          jobId,
          status: "running",
          chain: true,
          delayMs: 0,
          stagesRun,
          reason: "partial",
        };
      }

      if (result.kind === "skipped") {
        await saveState(jobId, workerId, state);
        await skipStage(jobId, name, result.reason);
        log("stage_skipped", { stage: name, reason: result.reason });
        stagesRun += 1;
        continue;
      }

      await saveState(jobId, workerId, state);
      await commitStage(jobId, name, result.output ?? {}, durationMs);

      stagesRun += 1;
      log("stage_done", {
        stage: name,
        durationMs,
        aiCalls: cost.aiCalls,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        measured: cost.measured,
      });
    } catch (err) {
      const durationMs = Date.now() - stageStart;

      /*
       * Running out of allowance is not running out of luck. Everything the
       * stage produced is kept, the stage stays mid-flight rather than failed,
       * and no retry is spent — it simply continues when the allowance
       * returns. Raised for the per-minute cap and for the provider's daily
       * one, which used to fail the job outright and throw the run away.
       */
      if (err instanceof TokenWindowExhausted) {
        await saveState(jobId, workerId, state);
        // Worded for the author, not the operator. What they need to know is
        // that nothing is broken; the token arithmetic behind it belongs in the
        // logs and the diagnostics view.
        await markStagePartial(
          jobId,
          name,
          err.allowance === "daily"
            ? "waiting for the daily AI allowance"
            : "paused for a moment",
        );
        await yieldJob(jobId, workerId, state, window);
        log("tpm_yield", {
          stage: name,
          allowance: err.allowance,
          resumeInMs: err.resumeInMs,
          durationMs,
        });
        return {
          jobId,
          status: "running",
          chain: true,
          delayMs: err.resumeInMs,
          stagesRun,
          reason: "token allowance",
        };
      }

      const failure =
        err instanceof StageFailure
          ? err
          : new StageFailure(
              "stage_error",
              err instanceof Error ? err.message : "The stage failed.",
              false,
            );

      /*
       * State is saved even on failure. A section stage that wrote three of
       * five groups before the provider stopped answering keeps those three —
       * the retry starts at group four, and the author never pays twice for the
       * same paragraph.
       */
      await saveState(jobId, workerId, state);
      log("stage_failed", {
        stage: name,
        code: failure.code,
        attempt: begun.attempt,
        retryable: failure.retryable,
        durationMs,
      });

      if (failure.retryable && begun.attempt < retryLimit()) {
        const hint =
          failure.code === "ai_rate_limit"
            ? 30_000
            : failure.code === "ai_unreachable"
              ? 3_000
              : 2_000;
        const wait = backoffMs(begun.attempt, hint);
        const remaining = deadline - Date.now();

        // Wait it out here when there is room, then re-run the same stage.
        if (wait < remaining - 5_000) {
          await new Promise((r) => setTimeout(r, wait));
          i -= 1;
          continue;
        }

        // Otherwise hand the wait to the next invocation rather than spending
        // this one's budget asleep.
        await failStage(jobId, name, failure.code, failure.message, durationMs);
        await resetForRetry(jobId, name);
        await yieldJob(jobId, workerId, state, window, "retrying");
        return {
          jobId,
          status: "retrying",
          chain: true,
          delayMs: wait,
          stagesRun,
          reason: failure.code,
        };
      }

      await failStage(jobId, name, failure.code, failure.message, durationMs);
      await finishJob(jobId, workerId, "failed", {
        code: failure.code,
        message: failure.message,
      });
      return {
        jobId,
        status: "failed",
        chain: false,
        delayMs: 0,
        stagesRun,
        reason: failure.code,
      };
    }
  }

  await saveState(jobId, workerId, state);
  await saveTokenWindow(jobId, workerId, window.toState());
  await finishJob(jobId, workerId, "completed");
  log("completed", {
    stagesRun,
    totalMs: Date.now() - startedAt,
    proseWords: state.words?.actual ?? 0,
  });

  return {
    jobId,
    status: "completed",
    chain: false,
    delayMs: 0,
    stagesRun,
    reason: "done",
  };
}

/** Persists everything this invocation learned, then lets go of the job. */
async function yieldJob(
  jobId: string,
  workerId: string,
  state: JobState,
  window: TokenWindow,
  status: JobRecord["status"] = "running",
): Promise<void> {
  await saveState(jobId, workerId, state);
  await saveTokenWindow(jobId, workerId, window.toState());
  await releaseLease(jobId, workerId, status);
}

/** Puts a stage back to pending so the next invocation attempts it again. */
async function resetForRetry(jobId: string, name: StageName): Promise<void> {
  await prisma.draftJobStage.updateMany({
    where: { draftJobId: jobId, name, status: "failed" },
    data: { status: "pending" },
  });
}
