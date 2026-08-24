/**
 * Waking the next worker.
 *
 * A job needs more invocations than any one request can provide, and there is
 * no queue service here to provide them. So an invocation that runs out of
 * budget asks for its own successor: it calls the runner route again, after its
 * response has been sent, via `after()`.
 *
 * `after()` is the piece that makes this work on Vercel. Detached work does not
 * survive a serverless response — that is already documented in the article
 * create route, and it is why research had to move into a live request — but
 * `after()` is the platform's supported way to keep the invocation alive past
 * the response, which is exactly long enough to hand the job to the next one.
 *
 * Three things can wake a job, deliberately:
 *   1. this chain, while everything is healthy;
 *   2. the browser's status poll, when the chain was dropped;
 *   3. the cron sweeper, when nobody has the page open at all.
 * Any of them alone is enough to finish a job. Together they mean a dead
 * function, a closed tab and a deploy mid-generation are all survivable.
 */

const ENCODER = new TextEncoder();

function secret(): string {
  return (process.env.AUTH_SECRET ?? "").trim();
}

/**
 * Signed permission to run one specific job.
 *
 * The runner route cannot use the session cookie: it is called by another
 * server invocation, and by cron, neither of which has one. A token scoped to a
 * single job id is the smallest credential that does the work — it cannot list
 * jobs, cannot read one, and is useless for any job but the one it names.
 */
export async function jobToken(jobId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, ENCODER.encode(`draft-job:${jobId}`));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyJobToken(jobId: string, token: string): Promise<boolean> {
  if (secret() === "" || token.trim() === "") return false;
  const expected = await jobToken(jobId);
  if (expected.length !== token.length) return false;

  // Constant-time compare: a token this cheap to guess byte-by-byte otherwise.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Where this deployment can reach itself.
 *
 * The host that served this request comes first, and that ordering is the
 * whole point. `VERCEL_URL` looks like the obvious answer — it is the
 * deployment's own hostname — but on a protected project that hostname sits
 * behind Vercel Authentication and answers a loopback call with a 302 to an SSO
 * login. The production alias is public; the deployment URL is not.
 *
 * That cost a full day's worth of confusion: the runner worked perfectly when
 * invoked by hand, and every job created through the UI sat at "queued"
 * forever, because each kick was quietly redirected to a login page and the
 * kicker treats failure as recoverable.
 *
 * A request that arrived on some host proves that host is reachable. So it is
 * used, and the environment variables are the fallback rather than the rule.
 */
export function selfOrigin(req?: Request): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (configured !== "") return configured.replace(/\/+$/, "");

  if (req !== undefined) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host =
      req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
      req.headers.get("host");
    if (host !== undefined && host !== null && host !== "") {
      return `${proto ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
    }
  }

  // Vercel's stable production domain, which is aliased and public.
  const production = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  if (production !== "") return `https://${production}`;

  const vercel = (process.env.VERCEL_URL ?? "").trim();
  if (vercel !== "") return `https://${vercel}`;

  return "http://localhost:3000";
}

/**
 * Asks for another invocation of the runner.
 *
 * Failures are swallowed on purpose. A dropped kick is not a lost job — the
 * poll and the sweeper both reclaim a job whose lease has expired — so an
 * exception here would turn a recoverable hiccup into a visible error for
 * something the system is about to fix by itself.
 */
export async function kickRunner(
  jobId: string,
  origin: string,
  delayMs = 0,
): Promise<void> {
  try {
    /*
     * The wait happens here, inside `after()`, because the successor cannot
     * schedule itself before it exists. Capped well under the route's 60-second
     * ceiling: a longer wait than this would kill the invocation doing the
     * waiting, and the job would sit until the poll or the sweeper found it.
     * A token window is 60 seconds, so two short waits cover the worst case.
     */
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(delayMs, 35_000)));
    }

    const token = await jobToken(jobId);
    const res = await fetch(`${origin}/api/draft-jobs/${jobId}/run`, {
      method: "POST",
      headers: { "x-job-token": token, "content-type": "application/json" },
      body: "{}",
      // A redirect is never a successful handoff — following one to an SSO
      // login would return 200 and look like the job had been picked up.
      redirect: "manual",
      // The successor owns the work; this call only needs to have been made.
      signal: AbortSignal.timeout(5_000),
    });

    /*
     * Logged, not thrown. A dropped kick really is recoverable — the poll and
     * the sweeper both reclaim a stalled job — but swallowing it in silence is
     * how a misconfigured origin went unnoticed while every job sat at
     * "queued". A line in the log is the difference between a puzzle and a
     * five-minute fix.
     */
    if (!res.ok && res.status !== 202) {
      console.log(
        JSON.stringify({
          scope: "draft-job",
          jobId,
          event: "kick_rejected",
          status: res.status,
          origin,
        }),
      );
    }
  } catch (err) {
    console.log(
      JSON.stringify({
        scope: "draft-job",
        jobId,
        event: "kick_failed",
        origin,
        reason: err instanceof Error ? err.name : "unknown",
      }),
    );
  }
}
