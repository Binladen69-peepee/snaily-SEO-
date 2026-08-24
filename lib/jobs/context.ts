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

export function makeAi(
  ctx: Pick<StageContext, "stage" | "cost" | "log"> & {
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
      req.maxTokens + reasoningReserve() * Math.max(1, ctx.attempt),
    );
    if (maxTokens === 0) throw new PromptTooLarge(ctx.stage);

    /*
     * What this request will cost the minute's allowance, counted the way the
     * provider counts it: prompt plus whatever the reply is permitted to be.
     * Reserving the full permitted reply rather than the likely one is the
     * conservative side to be wrong on — the alternative is a 429 that costs
     * the stage a retry and produces nothing.
     */
    const estimate =
      estimateTokens(req.system) + estimateTokens(req.user) + maxTokens;

    if (!ctx.window.roomFor(estimate)) {
      const resumeInMs = ctx.window.resetInMs();
      ctx.log("tpm_pause", {
        stage: ctx.stage,
        needed: estimate,
        remaining: ctx.window.remaining(),
        resumeInMs,
      });
      throw new TokenWindowExhausted(resumeInMs);
    }

    ctx.window.record(estimate);
    await ctx.onSpend(estimate);

    let result: AiCompletion;
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
