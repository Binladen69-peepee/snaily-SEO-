/**
 * Moz Links API — the only place real Domain Authority comes from.
 *
 * Domain Authority and Page Authority are Moz's own metrics, computed from
 * Moz's own link index. Nothing else produces them. The app had been showing
 * DataForSEO Rank in a column headed "DA", which is a different company's
 * score on a different index: for cinnamonsnail.com that reads 39 where Moz
 * says 48-49, and for iheartumami.com 47 where Moz says 51. No amount of
 * tuning closes that, because the two numbers are not measuring the same
 * thing.
 *
 * So when Moz credentials are present, DA and PA are fetched from Moz and are
 * genuinely Moz's numbers. Without them the app falls back to DataForSEO Rank
 * and must not call it DA.
 *
 * Docs: https://moz.com/api/docs — POST /v2/url_metrics, Basic auth with the
 * Access ID as username and the Secret Key as password.
 */

import { ensureSettings } from "@/lib/settings";

const ENDPOINT = "https://lsapi.seomoz.com/v2/url_metrics";
/** Moz accepts many targets per call; batching is the whole cost saving. */
const MAX_TARGETS = 50;

export type MozMetrics = {
  target: string;
  /** Moz Domain Authority, 0-100. Null when Moz had no answer. */
  domainAuthority: number | null;
  /** Moz Page Authority, 0-100. */
  pageAuthority: number | null;
  /** Moz Spam Score, 0-100 (percentage). */
  spamScore: number | null;
  linkingRootDomains: number | null;
};

export type MozCredentials = { accessId: string; secretKey: string };

export function readMozCredentials(): MozCredentials | null {
  const accessId = (process.env.MOZ_ACCESS_ID ?? "").trim();
  const secretKey = (process.env.MOZ_SECRET_KEY ?? "").trim();
  if (accessId === "" || secretKey === "") return null;
  return { accessId, secretKey };
}

export async function mozConfigured(): Promise<boolean> {
  await ensureSettings();
  return readMozCredentials() !== null;
}

export class MozError extends Error {
  readonly code: "not_configured" | "unauthorized" | "rate_limited" | "unavailable";
  constructor(code: MozError["code"], message: string) {
    super(message);
    this.name = "MozError";
    this.code = code;
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

/**
 * Fetch Moz metrics for a batch of domains or URLs.
 *
 * Targets are passed through as given: Moz treats `example.com` as the root
 * domain and `example.com/page` as that page, which is exactly the difference
 * between DA and PA.
 */
export async function fetchMozMetrics(
  targets: string[],
  opts: { fetchImpl?: typeof fetch; credentials?: MozCredentials } = {},
): Promise<{ rows: MozMetrics[] }> {
  const cleaned = [...new Set(targets.map((t) => t.trim()).filter((t) => t !== ""))];
  if (cleaned.length === 0) return { rows: [] };

  if (opts.credentials === undefined) await ensureSettings();
  const creds = opts.credentials ?? readMozCredentials();
  if (creds === null) {
    throw new MozError("not_configured", "Moz API credentials are not set.");
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const auth = Buffer.from(`${creds.accessId}:${creds.secretKey}`).toString("base64");
  const rows: MozMetrics[] = [];

  for (let i = 0; i < cleaned.length; i += MAX_TARGETS) {
    const batch = cleaned.slice(i, i + MAX_TARGETS);

    let res: Response;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targets: batch }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new MozError("unavailable", "Could not reach Moz.");
    }

    if (res.status === 401 || res.status === 403) {
      throw new MozError("unauthorized", "Moz rejected these API credentials.");
    }
    if (res.status === 429) {
      throw new MozError("rate_limited", "Moz rate limit reached. Try again shortly.");
    }
    if (!res.ok) {
      throw new MozError("unavailable", "Moz did not answer.");
    }

    const body = (await res.json()) as {
      results?: Record<string, unknown>[];
    };

    for (const item of body.results ?? []) {
      rows.push({
        target: String(item.page ?? item.root_domain ?? ""),
        domainAuthority: num(item.domain_authority),
        pageAuthority: num(item.page_authority),
        spamScore: num(item.spam_score),
        linkingRootDomains: num(item.root_domains_to_root_domain),
      });
    }
  }

  return { rows };
}

/** A cheap credential check that spends one row. */
export async function verifyMozCredentials(
  credentials: MozCredentials,
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; message: string; detail?: string }> {
  try {
    const { rows } = await fetchMozMetrics(["moz.com"], { credentials, fetchImpl });
    const da = rows[0]?.domainAuthority;
    return {
      ok: true,
      message: "Connected to Moz.",
      detail: da === null || da === undefined ? undefined : `moz.com reads DA ${String(da)}`,
    };
  } catch (err) {
    if (err instanceof MozError) {
      return { ok: false, message: err.message };
    }
    return { ok: false, message: "Could not reach Moz." };
  }
}
