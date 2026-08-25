/**
 * What a page's HTTP outcome actually means.
 *
 * The audit used to treat one thing as broken: `status === 0 || status >= 400`.
 * That put three very different outcomes in the same bucket, and the client
 * reported the consequence — links flagged as broken that open perfectly in a
 * browser.
 *
 * On cinnamonsnail.com the cause is visible in one request: Cloudflare answers
 * the crawler's `SEOToolBot/1.0` user agent with **429**, and a 429 is `>= 400`,
 * so a rate-limited page became a broken page, and every link pointing at it
 * became a broken link. A reader clicking that same link is never rate limited
 * and sees the post.
 *
 * A blocked or slow response is a statement about the crawler, not about the
 * link. Only a genuine 404/410/5xx — after a retry that gives the host a fair
 * chance — says the destination is actually gone.
 */

export type LinkState =
  | "valid"
  | "redirect"
  | "blocked"
  | "timeout"
  | "broken";

export type LinkOutcome = {
  state: LinkState;
  /** HTTP status, or 0 when the request never completed. */
  status: number;
  /** The URL finally landed on, after redirects. */
  finalUrl: string;
  /** True when the destination differs from the URL requested. */
  redirected: boolean;
  /** Human-readable reason, shown in the audit UI. */
  detail: string;
};

/**
 * Statuses that mean "the host declined to serve *us*", not "the page is gone".
 *
 * 401/403 are bot protection or auth walls; 429 is rate limiting. Cloudflare's
 * own extension codes sit in 520–530 and mean the edge could not reach the
 * origin for this request — also not a missing page.
 */
const BLOCKED_STATUSES = new Set([401, 403, 405, 406, 429, 451]);

function isCloudflareEdge(status: number): boolean {
  return status >= 520 && status <= 530;
}

/** Only these say the destination genuinely is not there. */
export function isGone(status: number): boolean {
  return status === 404 || status === 410;
}

/**
 * Classify a completed response.
 *
 * `requestedUrl` is what we asked for; `response.url` is where we ended up
 * after `redirect: "follow"`, so a 3xx chain arrives here as a 200 with a
 * different URL — which is a working link, not a broken one.
 */
export function classifyResponse(
  requestedUrl: string,
  status: number,
  finalUrl: string,
): LinkOutcome {
  const redirected = normalizeForCompare(finalUrl) !== normalizeForCompare(requestedUrl);

  if (status >= 200 && status < 300) {
    return redirected
      ? {
          state: "redirect",
          status,
          finalUrl,
          redirected,
          detail: `Redirects to ${finalUrl}`,
        }
      : { state: "valid", status, finalUrl, redirected, detail: "OK" };
  }

  // A 3xx that survived redirect:"follow" is a redirect we were not allowed to
  // continue (too many hops, or a cross-protocol hop). Still not broken.
  if (status >= 300 && status < 400) {
    return {
      state: "redirect",
      status,
      finalUrl,
      redirected: true,
      detail: `Redirect (${String(status)}) not followed`,
    };
  }

  if (BLOCKED_STATUSES.has(status) || isCloudflareEdge(status)) {
    return {
      state: "blocked",
      status,
      finalUrl,
      redirected,
      detail: `Host blocked the crawler (${String(status)}) — not a broken link`,
    };
  }

  if (isGone(status)) {
    return {
      state: "broken",
      status,
      finalUrl,
      redirected,
      detail: `Not found (${String(status)})`,
    };
  }

  if (status >= 500) {
    return {
      state: "broken",
      status,
      finalUrl,
      redirected,
      detail: `Server error (${String(status)})`,
    };
  }

  // Any other 4xx: report it, but as a block rather than a missing page.
  return {
    state: "blocked",
    status,
    finalUrl,
    redirected,
    detail: `Unexpected status ${String(status)}`,
  };
}

/** A request that never produced a response at all. */
export function classifyFailure(
  requestedUrl: string,
  err: unknown,
): LinkOutcome {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  const aborted = name === "AbortError" || /abort|timeout/i.test(message);

  return {
    state: aborted ? "timeout" : "blocked",
    status: 0,
    finalUrl: requestedUrl,
    redirected: false,
    detail: aborted
      ? "Timed out while crawling — not a broken link"
      : `Could not connect: ${message.slice(0, 120)}`,
  };
}

/**
 * Whether an outcome is worth a second attempt.
 *
 * A block or a timeout is about this request, so trying once more — with a
 * browser user agent, which is what the reader's link click actually looks
 * like — is the difference between a false report and a true one.
 */
export function shouldRetry(outcome: LinkOutcome): boolean {
  return outcome.state === "blocked" || outcome.state === "timeout";
}

/** Only a genuine failure counts against the site. */
export function isBroken(outcome: LinkOutcome): boolean {
  return outcome.state === "broken";
}

/**
 * Compare URLs ignoring the differences that never change what a reader sees:
 * protocol, a leading www, a trailing slash, and case in the host.
 */
export function normalizeForCompare(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${host}${path}${u.search}`;
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}
