/**
 * What a stage is handed, and the one way it is allowed to call a model.
 *
 * Every AI request in the pipeline goes through `ctx.ai()`. That is what makes
 * the cost accounting real rather than a guess: the tokens the provider
 * reports are added up on the stage that spent them, so "what did one article
 * cost" is answered from records instead of arithmetic. It is also the only
 * place that knows the per-request ceiling, so no stage can quietly decide to
 * send a bigger prompt than the plan allows.
 */

import {
  aiModel,
  AiError,
  AiRateLimit,
  completeDetailed,
  type AiCompletion,
} from "@/lib/ai";
import { estimateTokens, fitMaxTokens, reasoningReserve } from "@/lib/ai-policy";
import type { TokenWindow } from "@/lib/jobs/token-window";
import type { JobState, StageName } from "@/lib/jobs/types";

/** Raised when a stage cannot proceed and retrying would not help. */
export class StageFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "StageFailure";
  }
}

/**
 * Raised when the prompt for a request will not fit under the token ceiling.
 *
 * Its own error because the fix is never "retry": the same prompt fails the
 * same way every time. It means a stage needs to send less, and it is the
 * failure that used to surface as the provider's misleading "request too
 * large" message.
 */
export class PromptTooLarge extends StageFailure {
  constructor(stage: StageName) {
    super(
      "prompt_too_large",
      `The "${stage}" stage built a prompt larger than the model's per-request limit.`,
      false,
    );
    this.name = "PromptTooLarge";
  }
}

/**
 * Raised when the next call would break the per-minute allowance.
 *
 * Not a failure, and deliberately not a StageFailure: nothing went wrong and no
 * retry has been spent. The stage is asking to be continued in a moment, which
 * the runner honours by persisting what it has and scheduling the next
 * invocation for when the window rolls over.
 */
export class TokenWindowExhausted extends Error {
  constructor(
    readonly resumeInMs: number,
    /** Which allowance ran out, for the log. */
    readonly allowance: "per-minute" | "daily" = "per-minute",
  ) {
    super(`The ${allowance} token allowance is spent; continuing shortly.`);
    this.name = "TokenWindowExhausted";
  }
}

/**
 * Longest a single resume hop waits on the daily allowance.
 *
 * The resume is a scheduled re-invocation, so a two-hour reset is not slept
 * off in one go - the job wakes, finds the allowance still short, and pauses
 * again. Visible in the progress list as paused rather than failed, which is
 * the entire point.
 */
const DAILY_QUOTA_HOP_MS = 10 * 60_000;

export type JobArticle = {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  keyword: string;
  country: string;
  recipe: string;
  content: string;
};

export type StageCostTally = {
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
  /** False as soon as any call in the stage came back without usage numbers. */
  measured: boolean;
};

/** Books a completed call. Called per call, so nothing is lost on a yield. */
export type RecordCall = (usage: {
  input: number;
  output: number;
  provider: string;
  model: string;
}) => Promise<void>;

export type AiRequest = {
  system: string;
  user: string;
  /** Output ceiling before the prompt is subtracted from the budget. */
  maxTokens: number;
  temperature?: number;
};

export type StageContext = {
  jobId: string;
  stage: StageName;
  article: JobArticle;
  state: JobState;
  /** Wall-clock instant after which the stage must stop and yield. */
  deadline: number;
  cost: StageCostTally;
  /** Structured server log line. Never carries prompts or credentials. */
  log: (event: string, data?: Record<string, string | number | boolean>) => void;
  /** One bounded model call, metered and budget-checked. */
  ai: (req: AiRequest) => Promise<string>;
  /** Tokens still spendable in the current minute. */
  tokensLeft: () => number;
  /** True when there is no time left for another model call this invocation. */
  outOfTime: () => boolean;
};

/** Longest a single model call has ever taken here, plus margin. */
const CALL_ALLOWANCE_MS = 22_000;

/**
 * Whether to serve a token-allowance wait here or hand the job back.
 *
 * Yielding does not shorten the wait by a millisecond. It ends the invocation,
 * and the work then sits until something polls it awake — so handing back a
 * ten-second wait costs ten seconds plus the poll gap plus a fresh claim.
 *
 * The only reason to yield is having no time left to wait in: the invocation
 * has 45 seconds and must keep enough back for the call itself. So the
 * question is not "is this wait short" but "does this wait, and the call after
 * it, still fit" — which is a deadline, not a constant.
 */
function canWaitInline(waitMs: number, deadline: number): boolean {
  return Date.now() + waitMs + CALL_ALLOWANCE_MS < deadline;
}

export function makeAi(
  ctx: Pick<StageContext, "stage" | "cost" | "log" | "deadline"> & {
    attempt: number;
    window: TokenWindow;
    onSpend: (tokens: number) => Promise<void>;
    onCall: RecordCall;
  },
): (req: AiRequest) => Promise<string> {
  return async (req: AiRequest): Promise<string> => {
    /*
     * Stages ask for the length they want written; the reserve pays for the
     * thinking the model does first. Without it every stage silently loses a
     * few hundred words of its own budget to reasoning it cannot see.
     *
     * The reserve grows with the attempt, because the one thing known about a
     * retry after a truncated reply is that the previous allowance was not
     * enough. Repeating the identical request would fail identically.
     */
    const maxTokens = fitMaxTokens(
      req.system,
      req.user,
      req.maxTokens + reasoningReserve(aiModel()) * Math.max(1, ctx.attempt),
    );
    if (maxTokens === 0) throw new PromptTooLarge(ctx.stage);

    /*
     * What this request will cost the minute's allowance, counted the way the
     * provider counts it: prompt plus whatever the reply is permitted to be.
     * Reserving the full permitted reply rather than the likely one is the
     * conservative side to be wrong on — the alternative is a 429 that costs
     * the stage a retry and produces nothing.
     */
    /*
     * Reserve what the reply is likely to be, not the longest it may be.
     *
     * Admission is the slow part of a generation: a call is not made until the
     * whole reservation fits, and the allowance refills at a fixed rate, so an
     * over-reservation is paid for in seconds of waiting. Measured on this
     * pipeline, section calls ask for 1,000-1,200 completion tokens and write
     * 350-450; the outline reserved 2,818 and spent 2,337.
     *
     * Booking the ceiling made every call demand about a quarter more headroom
     * than it used, and at 7,360 tokens a minute that quarter is real time.
     *
     * The completion is still booked in full. Trimming it was tried and made
     * things worse: paired with a prompt estimate that ran 47% under the
     * provider's count, every call was admitted against a booking smaller than
     * it cost and the allowance went further into deficit with each one. The
     * reconciliation that follows the call returns whatever the reply did not
     * use, within the same second, which is where that saving belongs.
     */
    const estimate =
      estimateTokens(req.system) + estimateTokens(req.user) + maxTokens;

    if (!ctx.window.roomFor(estimate)) {
      /*
       * Wait for what this call needs, not for a whole fresh minute.
       *
       * The allowance refills continuously, so a call that is a few hundred
       * tokens short is usually a second or two away. Ending the invocation
       * for that costs far more than the wait: the job then sits until an
       * external poll starts it again. A short wait is served here; only a
       * long one is worth handing back.
       */
      const resumeInMs = ctx.window.waitFor(estimate);

      if (resumeInMs > 0 && canWaitInline(resumeInMs, ctx.deadline)) {
        ctx.log("tpm_wait", { stage: ctx.stage, needed: estimate, waitMs: resumeInMs });
        await new Promise((r) => setTimeout(r, resumeInMs));
      }

      if (!ctx.window.roomFor(estimate)) {
        ctx.log("tpm_pause", {
          stage: ctx.stage,
          needed: estimate,
          remaining: ctx.window.remaining(),
          resumeInMs,
        });
        throw new TokenWindowExhausted(resumeInMs);
      }
    }

    ctx.window.record(estimate);
    await ctx.onSpend(estimate);

    let result: AiCompletion;
    /*
     * Give the reservation back if the call did not happen.
     *
     * Spend is booked before the request, because a worker killed mid-call
     * still spent those tokens. But a call that never reached the provider
     * spent nothing, and the booking outlived it: a refused or aborted section
     * call left 6,453 tokens on the books permanently, so the next attempt
     * waited for an allowance that was already gone and the job fell further
     * behind on every cycle. A stage was measured sitting for seven minutes
     * without making a single call because of it.
     *
     * Released in the catch below unless the call returned, in which case the
     * reconciliation replaces the reservation with what was really used.
     */
    try {
      result = await completeDetailed({
        system: req.system,
        user: req.user,
        maxTokens,
        temperature: req.temperature,
        retryOnRateLimit: false,
      });
    } catch (err) {
      /*
       * Provider errors are re-thrown as stage failures carrying their own
       * retryability, so the runner never has to pattern-match on a message.
       * A rate limit is a wait; a rejected key is not.
       */
      /*
       * A daily allowance that refills is a wait, not a failure.
       *
       * Only the per-minute cap was ever handled this way. A job that hit the
       * daily cap was failed outright and the author lost everything the run
       * had produced - for a quota that came back in four minutes. It is the
       * same situation the per-minute pause exists for, so it raises the same
       * signal and the runner keeps the work, keeps the retries, and continues
       * when the allowance returns.
       */
      /*
       * Nothing was written, so nothing was spent — including on a refusal.
       *
       * Holding the reservation through a rate limit was tried and is wrong.
       * This window models the per-minute allowance, and a request the
       * provider refused never reached the model, so no per-minute tokens went
       * anywhere. Charging for it turned a real daily-cap refusal into phantom
       * per-minute debt on top: the bucket sat at 215 tokens of 7,360 while the
       * job waited on an allowance it had not actually spent, and every retry
       * booked another few thousand it would never get back.
       *
       * Pacing after a refusal is the yield's job, not the bucket's.
       */
      ctx.window.reconcile(estimate, 0);
      await ctx.onSpend(0);

      if (err instanceof AiRateLimit && err.daily && err.retryAfterMs > 0) {
        throw new TokenWindowExhausted(
          Math.min(err.retryAfterMs + 5_000, DAILY_QUOTA_HOP_MS),
          "daily",
        );
      }
      if (err instanceof AiRateLimit) {
        throw new StageFailure(err.code, err.message, err.retryable);
      }
      if (err instanceof AiError) {
        throw new StageFailure(err.code, err.message, err.retryable);
      }
      throw err;
    }

    /*
     * Give back what the reply did not use.
     *
     * The reservation above assumes the model writes to the very last
     * permitted token, which it almost never does. Keeping the difference on
     * the books made every later call in the run look unaffordable.
     */
    if (result.usage.measured) {
      ctx.window.reconcile(estimate, result.usage.input + result.usage.output);
    }


    ctx.cost.aiCalls += 1;
    ctx.cost.inputTokens += result.usage.input;
    ctx.cost.outputTokens += result.usage.output;
    ctx.cost.provider = result.provider;
    ctx.cost.model = result.model;
    if (!result.usage.measured) ctx.cost.measured = false;

    await ctx.onCall({
      input: result.usage.input,
      output: result.usage.output,
      provider: result.provider,
      model: result.model,
    });

    ctx.log("ai_call", {
      stage: ctx.stage,
      model: result.model,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
      /*
       * Split so the prompt can be argued about with numbers. The pipeline is
       * limited by tokens per minute and 86% of what it spends is prompt, so
       * "which half of this call is instructions" is the only question that
       * moves the total.
       */
      systemTokens: estimateTokens(req.system),
      userTokens: estimateTokens(req.user),
      reservedTokens: estimate,
      durationMs: result.durationMs,
    });

    return result.text;
  };
}

export function makeOutOfTime(deadline: number): () => boolean {
  return () => Date.now() + CALL_ALLOWANCE_MS > deadline;
}

/**
 * What a stage tells the runner when it returns.
 *
 * "partial" is the important one: it means real work was committed to the job
 * state but the invocation is out of time. The runner persists, releases the
 * lease and chains, and the same stage picks up where it stopped instead of
 * starting over — which is what keeps a five-call section stage inside a
 * 60-second function.
 */
export type StageResult =
  | { kind: "done"; output?: Record<string, unknown> }
  | { kind: "partial"; note: string }
  | { kind: "skipped"; reason: string };

export type StageImpl = (ctx: StageContext) => Promise<StageResult>;
