import { aiKey, aiModel, aiVendor, aiVendorLabel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/google/token-crypto";

/**
 * Live health of every configured integration.
 *
 * Every field here comes from an actual call to the provider or from a real
 * row in the database. Nothing is estimated: where a provider publishes no
 * expiry date, this says so rather than inventing one, and a check that cannot
 * run reports "unknown" instead of guessing "healthy".
 *
 * Probes are chosen to be free — SerpApi's account endpoint and the model list
 * endpoints cost no search and no tokens — so opening this page never spends
 * the client's quota.
 */

export type HealthLevel = "healthy" | "warning" | "failing" | "unknown";

export type HealthCheck = {
  /** Matches a SettingKey where one exists, otherwise a synthetic id. */
  id: string;
  label: string;
  level: HealthLevel;
  /** One line: what state it is in. */
  summary: string;
  /** Why it is in that state, and what to do. Empty when nothing to add. */
  reason: string;
  /** Supporting figures pulled from the provider, each already labelled. */
  facts: { label: string; value: string }[];
  /**
   * Consumption against a published allowance, when the provider reports one.
   * Absent means the provider does not publish it — never a guess.
   */
  usage?: {
    label: string;
    used: number;
    limit: number;
    unit: string;
    /** When the allowance resets, if the provider states it. */
    renewsAt?: string;
  }[];
  /** ISO date this credential stops working, when the provider states one. */
  expiresAt: string | null;
  /** True when this can only be changed in the hosting environment. */
  deploymentOnly: boolean;
  checkedAt: string;
};

const TIMEOUT_MS = 10_000;

/** Never let a provider's error text echo a key back into the UI. */
function redact(text: string, ...secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length > 6) out = out.split(s).join("«key»");
  }
  return out.slice(0, 300);
}

function env(...names: string[]): string {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [key, value] of Object.entries(process.env)) {
    if (wanted.has(key.toLowerCase()) && (value ?? "").trim() !== "") {
      return value!.trim();
    }
  }
  return "";
}

async function get(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

const days = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / 86_400_000);

/* -------------------------------------------------------------------------
 * SerpApi
 * ---------------------------------------------------------------------- */

type SerpAccount = {
  plan_name?: string;
  searches_per_month?: number;
  plan_searches_left?: number;
  total_searches_left?: number;
  this_month_usage?: number;
  this_hour_searches?: number;
  account_rate_limit_per_hour?: number;
  /** SerpApi states the renewal date outright, so it never has to be guessed. */
  plan_renewal_date?: string;
};

async function checkSerpApi(now: Date): Promise<HealthCheck> {
  const base = {
    id: "SERPAPI_KEY",
    label: "SerpApi key",
    deploymentOnly: false,
    expiresAt: null,
    checkedAt: now.toISOString(),
  };

  const key = env("SERPAPI_KEY");
  if (key === "") {
    return {
      ...base, level: "failing", facts: [],
      summary: "Not configured",
      reason:
        "Every live SERP feature — keyword research, rank checks, competitor citations and GEO Lab signals — needs this key.",
    };
  }

  try {
    // The account endpoint reports quota without spending a search.
    const res = await get(`https://serpapi.com/account?api_key=${encodeURIComponent(key)}`);
    const body = (await res.json().catch(() => ({}))) as SerpAccount & { error?: string };

    if (res.status === 401 || body.error) {
      return {
        ...base, level: "failing", facts: [],
        summary: "SerpApi rejected the key",
        reason: redact(body.error ?? "The key was not accepted.", key),
      };
    }
    if (!res.ok) {
      return {
        ...base, level: "unknown", facts: [],
        summary: `SerpApi returned ${String(res.status)}`,
        reason: "The account endpoint did not answer normally, so the key could not be confirmed either way.",
      };
    }

    let left = body.total_searches_left ?? body.plan_searches_left ?? null;
    const total = body.searches_per_month ?? null;

    // The account endpoint occasionally returns a wrong low figure — observed
    // reporting 123 remaining between two readings of 224, with usage
    // unchanged. Confirm anything alarming with a second sample and keep the
    // higher one, so a bad packet cannot raise a false "quota nearly spent".
    if (left !== null && total !== null && left / total <= 0.25) {
      const second = await get(
        `https://serpapi.com/account?api_key=${encodeURIComponent(key)}`,
      )
        .then((r) => (r.ok ? (r.json() as Promise<SerpAccount>) : null))
        .catch(() => null);

      const confirmed = second?.total_searches_left ?? second?.plan_searches_left ?? null;
      if (confirmed !== null) left = Math.max(left, confirmed);
    }

    // SerpApi states the renewal date, so the timeline is reported rather
    // than inferred from the calendar month.
    const renewal = body.plan_renewal_date ?? null;
    const renewsAt =
      renewal !== null && !Number.isNaN(Date.parse(renewal))
        ? new Date(renewal).toISOString()
        : undefined;

    const usage: NonNullable<HealthCheck["usage"]> = [];
    if (total !== null && body.this_month_usage !== undefined) {
      usage.push({
        label: "Searches this month",
        used: body.this_month_usage,
        limit: total,
        unit: "searches",
        renewsAt,
      });
    }
    if (body.account_rate_limit_per_hour !== undefined) {
      usage.push({
        label: "Searches this hour",
        used: body.this_hour_searches ?? 0,
        limit: body.account_rate_limit_per_hour,
        unit: "searches",
      });
    }

    const facts = [
      { label: "Plan", value: body.plan_name ?? "unknown" },
      {
        label: "Searches left",
        value: left === null ? "not reported" : total === null ? String(left) : `${String(left)} of ${String(total)}`,
      },
      { label: "Used this month", value: body.this_month_usage === undefined ? "not reported" : String(body.this_month_usage) },
    ];

    // Running out of searches is the realistic failure here, not expiry:
    // SerpApi keys do not carry one.
    if (left !== null && left <= 0) {
      return {
        ...base, level: "failing", facts, usage,
        summary: "Monthly search quota exhausted",
        reason: "Live SERP calls will fail until the quota resets or the plan is upgraded. Cached results still work for 7 days.",
      };
    }
    if (left !== null && total !== null && left / total <= 0.15) {
      return {
        ...base, level: "warning", facts, usage,
        summary: `Quota nearly spent — ${String(left)} searches left`,
        reason: "Under 15% of the monthly allowance remains. Rank tracking and GEO Lab mapping will stop once it reaches zero.",
      };
    }

    return {
      ...base, level: "healthy", facts, usage,
      summary: "Working",
      reason: "SerpApi keys do not expire; the limit that matters is the monthly search allowance above.",
    };
  } catch {
    return {
      ...base, level: "unknown", facts: [],
      summary: "Could not reach SerpApi",
      reason: "The account endpoint timed out. This is usually the network rather than the key.",
    };
  }
}

/* -------------------------------------------------------------------------
 * AI writing key (Groq or xAI)
 * ---------------------------------------------------------------------- */

async function checkAiKey(now: Date): Promise<HealthCheck> {
  const base = {
    id: "GROK_API_KEY",
    label: "AI writing key",
    deploymentOnly: false,
    expiresAt: null,
    checkedAt: now.toISOString(),
  };

  const key = aiKey();
  if (key === "") {
    return {
      ...base, level: "failing", facts: [],
      summary: "Not configured",
      reason: "Drafter and GEO Lab drafting both need this key. Groq keys start gsk_, xAI keys start xai-.",
    };
  }

  const vendor = aiVendorLabel();
  const model = aiModel();
  const listUrl =
    aiVendor() === "groq"
      ? "https://api.groq.com/openai/v1/models"
      : "https://api.x.ai/v1/models";

  const facts = [
    { label: "Vendor", value: `${vendor} (detected from the key prefix)` },
    { label: "Model", value: model },
  ];

  try {
    // Listing models validates the key without spending tokens.
    const res = await get(listUrl, { headers: { Authorization: `Bearer ${key}` } });
    const text = await res.text();

    if (res.status === 401 || res.status === 403) {
      return {
        ...base, level: "failing", facts,
        summary: `${vendor} rejected the key`,
        reason: redact(text, key) || "The key is expired, revoked or belongs to the other vendor.",
      };
    }
    if (!res.ok) {
      return {
        ...base, level: "unknown", facts,
        summary: `${vendor} returned ${String(res.status)}`,
        reason: redact(text, key),
      };
    }

    const parsed = JSON.parse(text) as { data?: { id?: string }[] };
    const ids = (parsed.data ?? []).map((m) => m.id).filter(Boolean) as string[];
    facts.push({ label: "Models available", value: String(ids.length) });

    // A valid key pointed at a model it cannot use fails only at generation
    // time, which is exactly the kind of surprise this page exists to prevent.
    if (ids.length > 0 && !ids.includes(model)) {
      return {
        ...base, level: "warning", facts,
        summary: `Key works, but the model "${model}" is not in this account's list`,
        reason: `Generation will fail until the model setting is changed to one of: ${ids.slice(0, 6).join(", ")}.`,
      };
    }

    return {
      ...base, level: "healthy", facts,
      summary: "Working",
      reason: `${vendor} does not publish an expiry for API keys. The practical limit is the account's rate and credit allowance.`,
    };
  } catch {
    return {
      ...base, level: "unknown", facts,
      summary: `Could not reach ${vendor}`,
      reason: "The models endpoint timed out, so the key could not be confirmed either way.",
    };
  }
}

/* -------------------------------------------------------------------------
 * Google OAuth client credentials
 * ---------------------------------------------------------------------- */

async function checkGoogleClient(now: Date): Promise<HealthCheck> {
  const base = {
    id: "GOOGLE_CLIENT_ID",
    label: "Google OAuth client",
    deploymentOnly: false,
    expiresAt: null,
    checkedAt: now.toISOString(),
  };

  const id = env("GOOGLE_CLIENT_ID");
  const secret = env("GOOGLE_CLIENT_SECRET");

  if (id === "" || secret === "") {
    return {
      ...base, level: "failing", facts: [],
      summary: id === "" && secret === "" ? "Not configured" : id === "" ? "Client ID missing" : "Client secret missing",
      reason: "Sign-in with Google and every Search Console or Analytics sync depend on both halves being set.",
    };
  }

  const facts = [{ label: "Client ID", value: `${id.slice(0, 12)}…${id.slice(-14)}` }];

  try {
    // A deliberately invalid grant separates the two failure modes: Google
    // answers invalid_client when the credentials are wrong and invalid_grant
    // when they are fine and only the (fake) token is bad.
    const res = await get("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        refresh_token: "health-probe-not-a-real-token",
        grant_type: "refresh_token",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };

    if (body.error === "invalid_grant") {
      return {
        ...base, level: "healthy", facts,
        summary: "Credentials accepted by Google",
        reason:
          "OAuth client secrets do not expire on their own, but they stop working if the secret is rotated or the client is deleted in Google Cloud Console.",
      };
    }
    if (body.error === "invalid_client") {
      return {
        ...base, level: "failing", facts,
        summary: "Google rejected the client ID or secret",
        reason: "The pair does not match a live OAuth client — most often the secret was rotated or the client was deleted in Google Cloud Console.",
      };
    }
    if (body.error === "unauthorized_client" || body.error === "deleted_client") {
      return {
        ...base, level: "failing", facts,
        summary: `Google reports: ${body.error}`,
        reason: redact(body.error_description ?? "", secret) || "The OAuth client is no longer usable.",
      };
    }

    return {
      ...base, level: "unknown", facts,
      summary: "Google gave an unexpected answer",
      reason: redact(`${body.error ?? ""} ${body.error_description ?? ""}`.trim(), secret) || "The probe could not classify the response.",
    };
  } catch {
    return {
      ...base, level: "unknown", facts,
      summary: "Could not reach Google",
      reason: "The token endpoint timed out, so the credentials could not be confirmed either way.",
    };
  }
}

/* -------------------------------------------------------------------------
 * Connected Google accounts — where real expiry actually lives
 * ---------------------------------------------------------------------- */

/**
 * Exchanges a stored refresh token for a fresh access token.
 *
 * Returns null when the check cannot be performed at all — no account, no
 * client credentials, or an undecryptable token — so "could not verify" is
 * never mistaken for "verified fine".
 */
async function verifyRefreshToken(): Promise<{ ok: boolean; reason: string } | null> {
  const id = env("GOOGLE_CLIENT_ID");
  const secret = env("GOOGLE_CLIENT_SECRET");
  if (id === "" || secret === "") return null;

  const account = await prisma.googleAccount.findFirst({
    select: { refreshTokenEncrypted: true },
  });
  if (!account || (account.refreshTokenEncrypted ?? "") === "") return null;

  let refresh: string;
  try {
    refresh = decryptToken(account.refreshTokenEncrypted);
  } catch {
    return null;
  }

  try {
    const res = await get("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) return { ok: true, reason: "" };

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: body.error ?? `HTTP ${String(res.status)}` };
  } catch {
    // A network failure is not evidence the token is bad.
    return null;
  }
}

async function checkGoogleTokens(now: Date): Promise<HealthCheck> {
  const base = {
    id: "GOOGLE_TOKENS",
    label: "Connected Google account",
    deploymentOnly: false,
    checkedAt: now.toISOString(),
  };

  try {
    const rows = await prisma.googleAccount.findMany({
      select: {
        email: true,
        tokenExpiresAt: true,
        refreshTokenEncrypted: true,
        lastError: true,
        scopes: true,
      },
    });

    if (rows.length === 0) {
      return {
        ...base, level: "warning", facts: [], expiresAt: null,
        summary: "No Google account connected",
        reason: "Search Console and Analytics data cannot sync until someone signs in with Google.",
      };
    }

    const broken = rows.find((r) => r.lastError !== null && r.lastError !== "");
    if (broken) {
      return {
        ...base, level: "failing", expiresAt: null,
        facts: [{ label: "Account", value: broken.email }],
        summary: `Google connection is failing for ${broken.email}`,
        reason: redact(broken.lastError ?? ""),
      };
    }

    const noRefresh = rows.filter((r) => (r.refreshTokenEncrypted ?? "") === "");
    const soonest = rows
      .map((r) => r.tokenExpiresAt)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    const facts = [
      { label: "Accounts", value: rows.map((r) => r.email).join(", ") },
      {
        label: "Access token expires",
        value: soonest === null ? "not recorded" : soonest.toISOString(),
      },
      {
        label: "Refresh token",
        value: noRefresh.length === 0 ? "stored for every account" : `missing for ${String(noRefresh.length)}`,
      },
      { label: "Scopes", value: rows[0]?.scopes ?? "not recorded" },
    ];

    // Without a refresh token the connection dies the moment the hour-long
    // access token lapses, and only a fresh consent brings it back.
    if (noRefresh.length > 0) {
      return {
        ...base, level: "failing", facts, expiresAt: soonest?.toISOString() ?? null,
        summary: "No refresh token stored",
        reason:
          "Google only issues a refresh token on first consent. Without one the connection stops as soon as the access token lapses — the account must be disconnected and reconnected.",
      };
    }

    // Actually spend the refresh token rather than trusting the row.
    //
    // Reading fields only tells you what was true last time something ran. A
    // revoked grant, or an OAuth client swapped underneath the stored tokens,
    // leaves every field looking healthy right up until a sync fails — so the
    // check performs the one operation the whole connection depends on.
    const refreshed = await verifyRefreshToken();
    if (refreshed !== null) {
      facts.push({ label: "Refresh verified just now", value: refreshed.ok ? "yes" : "no" });

      if (!refreshed.ok) {
        return {
          ...base, level: "failing", facts, expiresAt: soonest?.toISOString() ?? null,
          summary: "The stored token can no longer be exchanged",
          reason:
            refreshed.reason === "unauthorized_client" || refreshed.reason === "invalid_client"
              ? "Google rejected the refresh against the configured OAuth client. That usually means the client ID or secret was changed after these tokens were issued — refresh tokens only work with the client that created them. Restore the original client, or have each user reconnect."
              : `Google refused the refresh: ${refreshed.reason}. Access was most likely revoked in the Google account, and the user must reconnect.`,
        };
      }
    }

    // An expired access token with a working refresh token is normal: the next
    // request renews it silently.
    return {
      ...base, level: "healthy", facts, expiresAt: soonest?.toISOString() ?? null,
      summary:
        refreshed?.ok === true
          ? "Connected, and the refresh token still works"
          : soonest !== null && soonest.getTime() < now.getTime()
            ? "Access token lapsed — will renew automatically on the next sync"
            : "Connected and renewing automatically",
      reason:
        "Access tokens last about an hour and are refreshed automatically. The stored refresh token itself does not expire unless access is revoked in the Google account, the OAuth client secret is rotated, or the app sits unused for six months.",
    };
  } catch (e) {
    return {
      ...base, level: "unknown", facts: [], expiresAt: null,
      summary: "Could not read the connected accounts",
      reason: redact(e instanceof Error ? e.message : "Database read failed."),
    };
  }
}

/* -------------------------------------------------------------------------
 * Deployment-level values — visible here, changeable only in the host
 * ---------------------------------------------------------------------- */

async function checkDatabase(now: Date): Promise<HealthCheck> {
  const base = {
    id: "DATABASE_URL",
    label: "Database connection",
    deploymentOnly: true,
    expiresAt: null,
    checkedAt: now.toISOString(),
  };

  const url = env("DATABASE_URL");
  if (url === "") {
    return {
      ...base, level: "failing", facts: [],
      summary: "Not configured",
      reason: "Nothing in the app works without it. It must be set in the hosting environment, not here.",
    };
  }

  const host = /@([^/:?]+)/.exec(url)?.[1] ?? "unknown host";
  const started = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      ...base, level: "healthy",
      facts: [
        { label: "Host", value: host },
        { label: "Round trip", value: `${String(Date.now() - started)} ms` },
      ],
      summary: "Connected",
      reason: "Connection strings do not expire, but a rotated database password or a paused Supabase project will break this immediately.",
    };
  } catch (e) {
    return {
      ...base, level: "failing",
      facts: [{ label: "Host", value: host }],
      summary: "Cannot reach the database",
      reason: redact(e instanceof Error ? e.message : "Connection failed.", url),
    };
  }
}

async function checkAuthSecret(now: Date): Promise<HealthCheck> {
  const base = {
    id: "AUTH_SECRET",
    label: "Session & encryption secret",
    deploymentOnly: true,
    expiresAt: null,
    checkedAt: now.toISOString(),
  };

  const secret = env("AUTH_SECRET");
  if (secret === "") {
    return {
      ...base, level: "failing", facts: [],
      summary: "Not configured",
      reason: "Sign-in and stored Google tokens both depend on it. It must be set in the hosting environment.",
    };
  }

  const facts = [{ label: "Length", value: `${String(secret.length)} characters` }];

  // The real risk is a silent one: rotating this key leaves every stored
  // Google token undecryptable, and nothing reports that until a sync fails.
  try {
    const account = await prisma.googleAccount.findFirst({
      select: { email: true, refreshTokenEncrypted: true, accessTokenEncrypted: true },
    });

    if (!account) {
      return {
        ...base, level: "healthy", facts,
        summary: "Set",
        reason: "No stored Google tokens to verify it against yet. Changing it later signs everyone out and orphans any tokens stored in the meantime.",
      };
    }

    decryptToken(account.refreshTokenEncrypted || account.accessTokenEncrypted);
    return {
      ...base, level: "healthy",
      facts: [...facts, { label: "Decrypts stored tokens", value: "yes" }],
      summary: "Set and matching the stored tokens",
      reason: "It does not expire. Changing it signs every user out and makes stored Google tokens unreadable, forcing everyone to reconnect.",
    };
  } catch {
    return {
      ...base, level: "failing",
      facts: [...facts, { label: "Decrypts stored tokens", value: "no" }],
      summary: "Does not match the stored Google tokens",
      reason:
        "The secret has changed since those tokens were encrypted, so they can no longer be read. Either restore the previous value or have each user reconnect their Google account.",
    };
  }
}

/* -------------------------------------------------------------------------
 * Runner
 * ---------------------------------------------------------------------- */

let cache: { at: number; checks: HealthCheck[] } | null = null;
const CACHE_MS = 5 * 60_000;

/**
 * Runs every probe in parallel.
 *
 * Cached for five minutes so opening the page repeatedly does not hammer four
 * external services; the page offers an explicit re-check that bypasses it.
 * The cache is per server instance, which is the honest behaviour on
 * serverless — a re-check may land on an instance that has not probed yet.
 */
export async function runHealthChecks(force = false): Promise<HealthCheck[]> {
  if (!force && cache !== null && Date.now() - cache.at < CACHE_MS) {
    return cache.checks;
  }

  const now = new Date();
  const checks = await Promise.all([
    checkSerpApi(now),
    checkAiKey(now),
    checkGoogleClient(now),
    checkGoogleTokens(now),
    checkDatabase(now),
    checkAuthSecret(now),
  ]);

  cache = { at: Date.now(), checks };
  return checks;
}

/** Worst level present, for the page-level summary. */
export function overallLevel(checks: HealthCheck[]): HealthLevel {
  if (checks.some((c) => c.level === "failing")) return "failing";
  if (checks.some((c) => c.level === "warning")) return "warning";
  if (checks.some((c) => c.level === "unknown")) return "unknown";
  return "healthy";
}

/** Human phrasing for an expiry that is approaching. */
export function expiryNote(iso: string | null, now = new Date()): string | null {
  if (iso === null) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;

  const d = days(now, when);
  if (d < 0) return "lapsed";
  if (d === 0) return "expires today";
  if (d === 1) return "expires tomorrow";
  return `expires in ${String(d)} days`;
}
