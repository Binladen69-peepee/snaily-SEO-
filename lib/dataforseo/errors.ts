/**
 * Typed DataForSEO failures.
 *
 * Messages are safe for the UI. Provider bodies are truncated and never
 * include the Basic-auth header or credential values.
 */

export type DataForSeoErrorCode =
  | "not_configured"
  | "unauthorized"
  | "insufficient_balance"
  | "rate_limited"
  | "timeout"
  | "bad_request"
  | "unavailable"
  | "malformed"
  | "empty";

export class DataForSeoError extends Error {
  readonly code: DataForSeoErrorCode;
  readonly statusCode: number | null;
  readonly retryAfterMs: number | null;

  constructor(
    code: DataForSeoErrorCode,
    message: string,
    opts: { statusCode?: number | null; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = "DataForSeoError";
    this.code = code;
    this.statusCode = opts.statusCode ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

/** Map a DataForSEO task/status_code onto our typed error. */
export function errorFromStatus(
  statusCode: number,
  statusMessage: string,
): DataForSeoError {
  const msg = safeMessage(statusMessage);

  /*
   * Only 40100 is an authentication failure. 40101/40102 are "Internal SE
   * Server Error" — the search engine failed on DataForSEO's side, which
   * happens routinely for a deep request on a query with few real results.
   * Reporting those as a credential problem sent people to rotate a perfectly
   * good key, and made cache.ts re-throw instead of soft-failing.
   * A genuine bad login arrives as HTTP 401/403 and is caught in the client.
   */
  if (statusCode === 40100) {
    return new DataForSeoError(
      "unauthorized",
      "DataForSEO rejected the login or password.",
      { statusCode },
    );
  }
  if (statusCode === 40101 || statusCode === 40102) {
    return new DataForSeoError(
      "unavailable",
      msg || "DataForSEO's search engine returned an internal error.",
      { statusCode, retryAfterMs: 15_000 },
    );
  }
  if (statusCode === 40200 || statusCode === 40201 || statusCode === 40202) {
    return new DataForSeoError(
      "insufficient_balance",
      "DataForSEO reports insufficient account balance.",
      { statusCode },
    );
  }
  if (statusCode === 40204 || statusCode === 42900) {
    return new DataForSeoError(
      "rate_limited",
      "DataForSEO rate limit reached. Try again shortly.",
      { statusCode, retryAfterMs: 30_000 },
    );
  }
  if (statusCode >= 40000 && statusCode < 50000) {
    return new DataForSeoError("bad_request", msg || "DataForSEO rejected the request.", {
      statusCode,
    });
  }
  if (statusCode >= 50000) {
    return new DataForSeoError(
      "unavailable",
      msg || "DataForSEO is temporarily unavailable.",
      { statusCode, retryAfterMs: 15_000 },
    );
  }
  return new DataForSeoError("unavailable", msg || "DataForSEO request failed.", {
    statusCode,
  });
}

function safeMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 200);
}
