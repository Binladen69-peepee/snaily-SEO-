/**
 * Low-level DataForSEO HTTP client.
 *
 * Uses HTTP Basic auth from server-side credentials. Never logs the
 * Authorization header or credential values.
 */

import {
  dataForSeoBaseUrl,
  requireCredentials,
  type DataForSeoCredentials,
} from "@/lib/dataforseo/config";
import { ensureSettings } from "@/lib/settings";
import { DataForSeoError, errorFromStatus } from "@/lib/dataforseo/errors";
import { log } from "@/lib/log";
import { assertProviderSpend, recordProviderSpend } from "@/lib/spend";

export type DataForSeoTaskResult<T> = {
  statusCode: number;
  statusMessage: string;
  cost: number;
  result: T[];
  rawTaskCount: number;
};

type Envelope = {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    cost?: number;
    result?: unknown;
    result_count?: number;
  }>;
};

const DEFAULT_TIMEOUT_MS = 25_000;

export async function dataForSeoPost<T>(
  path: string,
  body: unknown[],
  opts: {
    timeoutMs?: number;
    credentials?: DataForSeoCredentials;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<DataForSeoTaskResult<T>> {
  /*
   * Credentials come out of process.env, which is only correct once the
   * encrypted settings store has been hydrated into it. Doing that here means
   * a key saved in the UI is used by the very next request, on any instance,
   * rather than waiting for a redeploy. Cached for a short TTL, so this is not
   * a database round trip per call.
   */
  if (opts.credentials === undefined) await ensureSettings();
  const creds = opts.credentials ?? requireCredentials();
  await assertProviderSpend("dataforseo");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${dataForSeoBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(creds),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timer);
    if (isAbortError(err)) {
      throw new DataForSeoError("timeout", "DataForSEO request timed out.", {
        retryAfterMs: 10_000,
      });
    }
    throw new DataForSeoError(
      "unavailable",
      "DataForSEO request failed to reach the provider.",
      { retryAfterMs: 15_000 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new DataForSeoError(
      "unauthorized",
      "DataForSEO rejected the login or password.",
      { statusCode: response.status },
    );
  }
  if (response.status === 402) {
    throw new DataForSeoError(
      "insufficient_balance",
      "DataForSEO reports insufficient account balance.",
      { statusCode: 402 },
    );
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "30");
    throw new DataForSeoError(
      "rate_limited",
      "DataForSEO rate limit reached. Try again shortly.",
      {
        statusCode: 429,
        retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 30_000,
      },
    );
  }
  if (!response.ok) {
    throw new DataForSeoError(
      "unavailable",
      `DataForSEO returned HTTP ${response.status}.`,
      { statusCode: response.status, retryAfterMs: 15_000 },
    );
  }

  let envelope: Envelope;
  try {
    envelope = (await response.json()) as Envelope;
  } catch {
    throw new DataForSeoError("malformed", "DataForSEO returned a non-JSON body.");
  }

  const topCode = Number(envelope.status_code ?? 0);
  if (topCode !== 20000) {
    throw errorFromStatus(topCode, String(envelope.status_message ?? ""));
  }

  const task = envelope.tasks?.[0];
  if (!task) {
    throw new DataForSeoError("empty", "DataForSEO returned no tasks.");
  }

  const taskCode = Number(task.status_code ?? 0);
  if (taskCode !== 20000) {
    throw errorFromStatus(taskCode, String(task.status_message ?? ""));
  }

  const resultRaw = task.result;
  const result = Array.isArray(resultRaw) ? (resultRaw as T[]) : [];
  const cost = Number(task.cost ?? envelope.cost ?? 0) || 0;
  await recordProviderSpend("dataforseo", cost, 1);
  log("dfs.call", { path, cost, rows: result.length });

  return {
    statusCode: taskCode,
    statusMessage: String(task.status_message ?? "Ok."),
    cost,
    result,
    rawTaskCount: envelope.tasks?.length ?? 1,
  };
}

/** GET helper for appendix endpoints (user_data). */
export async function dataForSeoGet<T>(
  path: string,
  opts: {
    timeoutMs?: number;
    credentials?: DataForSeoCredentials;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<T> {
  if (opts.credentials === undefined) await ensureSettings();
  const creds = opts.credentials ?? requireCredentials();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${dataForSeoBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(creds),
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timer);
    if (isAbortError(err)) {
      throw new DataForSeoError("timeout", "DataForSEO request timed out.", {
        retryAfterMs: 10_000,
      });
    }
    throw new DataForSeoError(
      "unavailable",
      "DataForSEO request failed to reach the provider.",
      { retryAfterMs: 15_000 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new DataForSeoError(
      "unauthorized",
      "DataForSEO rejected the login or password.",
      { statusCode: response.status },
    );
  }
  if (response.status === 402) {
    throw new DataForSeoError(
      "insufficient_balance",
      "DataForSEO reports insufficient account balance.",
      { statusCode: 402 },
    );
  }
  if (response.status === 429) {
    throw new DataForSeoError(
      "rate_limited",
      "DataForSEO rate limit reached. Try again shortly.",
      { statusCode: 429, retryAfterMs: 30_000 },
    );
  }
  if (!response.ok) {
    throw new DataForSeoError(
      "unavailable",
      `DataForSEO returned HTTP ${response.status}.`,
      { statusCode: response.status, retryAfterMs: 15_000 },
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new DataForSeoError("malformed", "DataForSEO returned a non-JSON body.");
  }
}

function basicAuthHeader(creds: DataForSeoCredentials): string {
  const token = Buffer.from(`${creds.login}:${creds.password}`, "utf8").toString(
    "base64",
  );
  return `Basic ${token}`;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name: string }).name === "AbortError")
  );
}
