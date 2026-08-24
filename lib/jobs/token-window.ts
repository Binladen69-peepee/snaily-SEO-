/**
 * Spending the per-minute token allowance on purpose instead of by accident.
 *
 * The provider meters prompt plus completion against a rolling minute — 8,000
 * tokens on this account's model. A staged article needs roughly 15,000, so it
 * cannot be written inside one minute at any speed, and the only question is
 * whether the pipeline notices that before the provider does.
 *
 * Before this existed it did not. Stages fired back to back, the fourth or
 * fifth call came back 429, and the stage burned its retries in a couple of
 * seconds because a rate-limit rejection arrives almost instantly. The article
 * failed for a reason that was never a failure: it was simply going faster than
 * it was allowed to.
 *
 * So the job carries its own window. A call that will not fit does not get
 * made; the worker yields, and the next invocation starts when there is room.
 * The generation takes about three minutes, which nobody is watching, instead
 * of failing in forty seconds, which everybody is.
 */

import { tpmBudget } from "@/lib/ai-policy";

const WINDOW_MS = 60_000;

/**
 * Headroom kept back from the stated limit.
 *
 * The provider counts tokens its own way and our prompt estimate is a
 * character-count approximation, so spending to the last token means
 * discovering the difference as a 429.
 */
const SAFETY = 0.9;

export type TokenWindowState = {
  startedAt: Date | null;
  tokens: number;
};

export class TokenWindow {
  private startedAt: number;
  private tokens: number;

  constructor(state: TokenWindowState, now = Date.now()) {
    const started = state.startedAt?.getTime() ?? 0;
    const fresh = started === 0 || now - started >= WINDOW_MS;
    this.startedAt = fresh ? now : started;
    this.tokens = fresh ? 0 : state.tokens;
  }

  /** How many tokens are still spendable in the current minute. */
  remaining(now = Date.now()): number {
    this.roll(now);
    return Math.max(0, Math.floor(tpmBudget() * SAFETY) - this.tokens);
  }

  /** The most any single call can ever be granted. */
  capacity(): number {
    return Math.floor(tpmBudget() * SAFETY);
  }

  /**
   * Whether a call this size can ever fit, on an empty window.
   *
   * A request larger than the whole allowance is a different problem from one
   * that is merely too big for what is left of this minute, and conflating the
   * two livelocks the job: `roomFor` returns false, the worker yields, the
   * window resets, and it returns false again forever. A section prompt that
   * grew past the budget put a real job in exactly that loop - it yielded every
   * few seconds for twenty minutes without making a single call.
   */
  canEverFit(estimate: number): boolean {
    return estimate <= this.capacity();
  }

  /** True when a request of this size fits in what is left of the minute. */
  roomFor(estimate: number, now = Date.now()): boolean {
    /*
     * A call that cannot fit an empty window is let through rather than
     * deferred forever. It will spend the whole minute and may still come back
     * 429, which the stage already retries - both of which are recoverable,
     * and neither of which is a job that never finishes.
     */
    if (!this.canEverFit(estimate)) return this.tokens === 0;
    return estimate <= this.remaining(now);
  }

  /** Milliseconds until the window resets and the full allowance returns. */
  resetInMs(now = Date.now()): number {
    this.roll(now);
    return Math.max(0, this.startedAt + WINDOW_MS - now);
  }

  record(tokens: number, now = Date.now()): void {
    this.roll(now);
    this.tokens += tokens;
  }

  toState(): TokenWindowState {
    return { startedAt: new Date(this.startedAt), tokens: this.tokens };
  }

  private roll(now: number): void {
    if (now - this.startedAt >= WINDOW_MS) {
      this.startedAt = now;
      this.tokens = 0;
    }
  }
}
