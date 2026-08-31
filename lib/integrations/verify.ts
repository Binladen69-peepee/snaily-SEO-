/**
 * Check a provider's credentials *before* they are stored.
 *
 * The point is the ordering. Saving and then checking means a typo replaces a
 * working key with a broken one and the owner finds out when a feature stops
 * working. Checking a candidate first means a failed verification costs
 * nothing: the previous value is still there, untouched.
 *
 * Every probe here is read-only and free or near-free, and none of them
 * involves a real user's credentials.
 */

import { dataForSeoGet } from "@/lib/dataforseo/client";
import { DataForSeoError } from "@/lib/dataforseo/errors";
import type { ProviderId } from "@/lib/integrations/providers";
import { verifyMozCredentials } from "@/lib/moz/client";
import type { SettingKey } from "@/lib/settings";

export type VerifyResult = {
  ok: boolean;
  /** Owner-facing, never the provider's raw text. */
  message: string;
  /** Extra detail worth showing, e.g. an account name or remaining quota. */
  detail?: string;
};

type Values = Partial<Record<SettingKey, string>>;

/** DataForSEO: the account endpoint authenticates without spending anything. */
async function verifyDataForSeo(values: Values): Promise<VerifyResult> {
  const login = (values.DATAFORSEO_LOGIN ?? "").trim();
  const password = (values.DATAFORSEO_PASSWORD ?? "").trim();

  if (login === "" || password === "") {
    return { ok: false, message: "Both the API login and password are needed." };
  }

  try {
    const body = await dataForSeoGet<{
      tasks?: { result?: { money?: { balance?: number } }[] }[];
    }>("/v3/appendix/user_data", {
      credentials: { login, password },
      timeoutMs: 15_000,
    });

    const balance = body.tasks?.[0]?.result?.[0]?.money?.balance;
    return {
      ok: true,
      message: "Connected.",
      detail:
        typeof balance === "number"
          ? `Account balance $${balance.toFixed(2)}`
          : undefined,
    };
  } catch (err) {
    if (err instanceof DataForSeoError) {
      if (err.code === "unauthorized") {
        return { ok: false, message: "DataForSEO rejected this login and password." };
      }
      if (err.code === "insufficient_balance") {
        // The credentials are right; the account simply has no funds.
        return { ok: true, message: "Connected, but the account balance is empty." };
      }
      if (err.code === "timeout") {
        return { ok: false, message: "DataForSEO did not respond in time." };
      }
    }
    return { ok: false, message: "Could not reach DataForSEO." };
  }
}

/**
 * Google: check the OAuth client, not a user.
 *
 * Posting a deliberately invalid authorization code to the token endpoint
 * authenticates the *client* and nothing else. Google answers `invalid_client`
 * when the id and secret do not match, and `invalid_grant` when they do and
 * only the code was wrong — which is the answer we want. No user, no consent,
 * no token issued.
 */
async function verifyGoogle(values: Values): Promise<VerifyResult> {
  const clientId = (values.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (values.GOOGLE_CLIENT_SECRET ?? "").trim();

  if (clientId === "" || clientSecret === "") {
    return { ok: false, message: "Both the client ID and secret are needed." };
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: "snaily-configuration-probe",
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        redirect_uri: "http://localhost",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = (await res.json()) as { error?: string };

    if (body.error === "invalid_grant") {
      return {
        ok: true,
        message: "Client ID and secret accepted by Google.",
        detail: "Redirect URIs are configured in the Google Cloud console.",
      };
    }
    if (body.error === "invalid_client") {
      return { ok: false, message: "Google rejected this client ID and secret." };
    }
    return { ok: false, message: "Google did not accept this configuration." };
  } catch {
    return { ok: false, message: "Could not reach Google." };
  }
}

/** SerpApi: the account endpoint reports quota without spending a search. */
async function verifySerpApi(values: Values): Promise<VerifyResult> {
  const key = (values.SERPAPI_KEY ?? "").trim();
  if (key === "") return { ok: false, message: "An API key is needed." };

  try {
    const res = await fetch(
      `https://serpapi.com/account?api_key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "SerpApi rejected this key." };
    }
    if (!res.ok) return { ok: false, message: "SerpApi did not respond." };

    const body = (await res.json()) as {
      error?: string;
      total_searches_left?: number;
    };
    if (body.error !== undefined) {
      return { ok: false, message: "SerpApi rejected this key." };
    }
    return {
      ok: true,
      message: "Connected.",
      detail:
        typeof body.total_searches_left === "number"
          ? `${String(body.total_searches_left)} searches left this month`
          : undefined,
    };
  } catch {
    return { ok: false, message: "Could not reach SerpApi." };
  }
}

/**
 * Verify one provider's candidate values.
 *
 * A provider with no cheap probe returns ok — refusing to save a key we cannot
 * check would make it impossible to configure at all, which is worse than
 * saving it unverified and letting the feature report its own health.
 */
export async function verifyProvider(
  provider: ProviderId,
  values: Values,
): Promise<VerifyResult> {
  switch (provider) {
    case "dataforseo":
      return verifyDataForSeo(values);
    case "google":
      return verifyGoogle(values);
    case "serpapi":
      return verifySerpApi(values);
    case "moz": {
      const accessId = (values.MOZ_ACCESS_ID ?? "").trim();
      const secretKey = (values.MOZ_SECRET_KEY ?? "").trim();
      if (accessId === "" || secretKey === "") {
        return { ok: false, message: "Both the Access ID and Secret Key are needed." };
      }
      return verifyMozCredentials({ accessId, secretKey });
    }
    default:
      return {
        ok: true,
        message: "Saved. This provider has no verification probe.",
      };
  }
}
