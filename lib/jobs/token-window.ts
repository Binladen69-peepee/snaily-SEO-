/**
 * Spending the per-minute token allowance on purpose instead of by accident.
 *
 * The provider meters prompt plus completion against a rolling minute — 8,000
 * tokens on this account, for every model it offers. A staged article needs
 * roughly 15,000, so it cannot be written inside one minute at any speed, and
 * the only question is whether the pipeline notices that before the provider
 * does.
 *
 * Before this existed it did not. Stages fired back to back, the fourth or
 * fifth call came back 429, and the stage burned its retries in a couple of
 * seconds because a rate-limit rejection arrives almost instantly. The article
 * failed for a reason that was never a failure: it was simply going faster than
 * it was allowed to.
 *
 * So the job carries its own window. A call that will not fit does not get
 * made; the worker waits, and continues when there is room.
 *
 * ## Why this is a bucket and not a window
 *
 * It used to reset in one step: spend anything, and the whole minute was gone
 * until sixty seconds had passed since the first call. Groq does not work that
 * way. Its own headers give the game away — `x-ratelimit-reset-tokens` comes
 * back at `157ms` on a nearly-full bucket, because the allowance refills
 * continuously rather than in a lump.
 *
 * Modelling a continuous refill as a step function is expensive in exactly one
 * direction: it always says "empty" when the truth is "mostly full". Measured
 * on a real sixteen-stage run, the pipeline paused 237 times to make 23 calls —
 * ten refusals per call, each ending an invocation that then waited for a poll
 * to start it again. Eight seconds of work took nineteen minutes.
 *
 * So the allowance drains as it is spent and refills at a steady rate, which is
 * what the provider is actually doing, and a request waits only as long as it
 * takes to afford that request rather than for a whole fresh minute.
 */

import { tpmBudget } from "@/lib/ai-policy";

const WINDOW_MS = 60_000;

/**
 * Headroom kept back from the stated limit.
 *
 * Syncing to the provider's own `x-ratelimit-remaining-tokens` was tried here
 * and made throughput worse, so it is deliberately not done. Groq reports what
 * is left of ITS window, which is larger than ours and refills faster; adopting
 * its post-call figure re-pinned this bucket to a low value after every call
 * and then refilled it more slowly than the provider was refilling, so the gap
 * never closed. A local model that reconciles against measured usage tracks
 * well enough, and errs on the safe side.
 *
 * The provider counts tokens its own way and our prompt estimate is a
 * character-count approximation, so spending to the last token means
 * discovering the difference as a 429.
 */
const SAFETY = 0.9;

export type TokenWindowState = {
  /** When `tokens` was last brought up to date. */
  startedAt: Date | null;
  /** Tokens outstanding against the allowance at that instant. */
  tokens: number;
};

export class TokenWindow {
  private startedAt: number;
  private tokens: number;

  constructor(state: TokenWindowState, now = Date.now()) {
    const started = state.startedAt?.getTime() ?? 0;
    // A stored instant from the future is a clock change, not a debt.
    const usable = started > 0 && started <= now;
    this.startedAt = usable ? started : now;
    this.tokens = usable ? Math.max(0, state.tokens) : 0;
    this.roll(now);
  }

  /** The most any single call can ever be granted. */
  capacity(): number {
    return Math.floor(tpmBudget() * SAFETY);
  }

  /** Tokens refilled per millisecond, at the provider's steady rate. */
  private ratePerMs(): number {
    return this.capacity() / WINDOW_MS;
  }

  /** How many tokens are spendable right now. */
  remaining(now = Date.now()): number {
    this.roll(now);
    return Math.max(0, this.capacity() - this.tokens);
  }

  /**
   * Whether a call this size can ever fit, on an empty allowance.
   *
   * A request larger than the whole allowance is a different problem from one
   * that is merely too big for what is left, and conflating the two livelocks
   * the job: `roomFor` returns false, the worker yields, and it returns false
   * again forever. A section prompt that grew past the budget put a real job in
   * exactly that loop — it yielded every few seconds for twenty minutes without
   * making a single call.
   */
  canEverFit(estimate: number): boolean {
    return estimate <= this.capacity();
  }

  /** True when a request of this size fits in what is left. */
  roomFor(estimate: number, now = Date.now()): boolean {
    /*
     * A call that cannot fit an empty allowance is let through rather than
     * deferred forever. It will spend everything and may still come back 429,
     * which the stage already retries — both of which are recoverable, and
     * neither of which is a job that never finishes.
     */
    if (!this.canEverFit(estimate)) return this.tokens === 0;
    return estimate <= this.remaining(now);
  }

  /**
   * Milliseconds until a request of this size can be afforded.
   *
   * The old answer was "however long is left of the minute", which was the
   * same answer for a call needing 50 tokens and one needing 5,000. This is
   * the time to refill the actual shortfall, so a nearly-affordable call waits
   * a moment rather than the better part of a minute.
   */
  waitFor(estimate: number, now = Date.now()): number {
    const short = estimate - this.remaining(now);
    if (short <= 0) return 0;
    return Math.ceil(short / this.ratePerMs());
  }

  /** Milliseconds until the allowance is completely refilled. */
  resetInMs(now = Date.now()): number {
    this.roll(now);
    if (this.tokens <= 0) return 0;
    return Math.ceil(this.tokens / this.ratePerMs());
  }

  record(tokens: number, now = Date.now()): void {
    this.roll(now);
    this.tokens += Math.max(0, tokens);
  }

  /**
   * Replace a reservation with what the call actually cost.
   *
   * Every call is booked before it is made, at prompt plus the largest reply
   * the model is permitted to write. Replies are rarely that long — a measured
   * outline reserved about 4,300 tokens and spent 3,231 — and the difference
   * was never given back, so the pipeline spent the run believing it was a
   * third poorer than it was. The provider bills what was used, and so does
   * this now.
   */
  reconcile(reserved: number, actual: number, now = Date.now()): void {
    this.roll(now);
    this.tokens = Math.max(0, this.tokens - Math.max(0, reserved) + Math.max(0, actual));
  }

  toState(): TokenWindowState {
    return { startedAt: new Date(this.startedAt), tokens: this.tokens };
  }

  /** Drain what has refilled since the last accounting. */
  private roll(now: number): void {
    const elapsed = now - this.startedAt;
    if (elapsed <= 0) return;
    this.tokens = Math.max(0, this.tokens - elapsed * this.ratePerMs());
    this.startedAt = now;
  }
}
