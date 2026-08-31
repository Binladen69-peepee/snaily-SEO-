/**
 * Safe Google OAuth diagnostics.
 *
 * Never includes client secret, access token, refresh token, or authorization
 * code. Used so "Access blocked" / "Something went wrong" is never the only
 * thing a person sees.
 */

import { googleIsConfigured, getRedirectUri } from "@/lib/google/oauth";
import { LOGIN_SCOPES } from "@/lib/google/types";
import { settingsLoaded } from "@/lib/settings";

/** The client's production OAuth client — compared, never used as a credential. */
export const PRODUCTION_GOOGLE_CLIENT_ID =
  "791613313131-vv8pdras4h79ad591takno3cp63u0mse.apps.googleusercontent.com";

export const PRODUCTION_REDIRECT_URI =
  "https://cinnamon-snail-seo-tool.vercel.app/api/google/callback";

export type OAuthDiagnostic = {
  environmentConfigured: boolean;
  settingsHydrated: boolean;
  clientIdSuffix: string | null;
  clientIdMatchesProduction: boolean | null;
  redirectUri: string;
  redirectUriMatchesProduction: boolean | null;
  scopes: string[];
  host: string;
};

export function clientIdSuffix(id: string): string {
  const trimmed = id.trim();
  if (trimmed === "") return "";
  const at = trimmed.indexOf(".apps.googleusercontent.com");
  const body = at > 0 ? trimmed.slice(0, at) : trimmed;
  return body.length <= 12 ? body : body.slice(-12);
}

export function buildOAuthDiagnostic(origin: string): OAuthDiagnostic {
  const id = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const redirectUri = getRedirectUri(origin);
  const isProdHost = origin.includes("cinnamon-snail-seo-tool.vercel.app");

  return {
    environmentConfigured: googleIsConfigured(),
    settingsHydrated: settingsLoaded(),
    clientIdSuffix: id === "" ? null : clientIdSuffix(id),
    clientIdMatchesProduction: isProdHost
      ? id === PRODUCTION_GOOGLE_CLIENT_ID
      : null,
    redirectUri,
    redirectUriMatchesProduction: isProdHost
      ? redirectUri === PRODUCTION_REDIRECT_URI
      : null,
    scopes: [...LOGIN_SCOPES],
    host: origin,
  };
}

export type OAuthStep =
  | "start"
  | "consent"
  | "callback"
  | "token_exchange"
  | "account_saved"
  | "property_discovery";

const SAFE_CONSENT: Record<string, string> = {
  access_denied:
    "Google consent was cancelled or blocked. If you saw “Access blocked”, the OAuth consent screen is likely in Testing and this Google account is not a test user — add it in Google Cloud, or publish the app.",
  admin_policy_enforced:
    "A Google Workspace policy blocked this app. Ask the Workspace admin to allow it, or sign in with a personal Google account that owns Search Console and Analytics.",
  unauthorized_client:
    "This OAuth client is not allowed to request these scopes. Check the Google Cloud OAuth client type (Web application) and the enabled APIs.",
  invalid_request:
    "Google rejected the authorization request. The usual cause is a redirect URI that is not listed on the OAuth client.",
  server_error: "Google had an internal error during consent. Try again.",
  temporarily_unavailable:
    "Google was temporarily unavailable during consent. Try again.",
};

export function consentErrorMessage(googleError: string): string {
  const key = googleError.trim().toLowerCase();
  if (SAFE_CONSENT[key]) return SAFE_CONSENT[key]!;
  if (key.includes("access_blocked") || key.includes("access blocked")) {
    return "Google blocked access before sending you back. Typical causes: the consent screen is in Testing and this account is not a test user, or Search Console / Analytics APIs are not enabled on the OAuth client’s Cloud project.";
  }
  if (key.includes("redirect_uri")) {
    return "Google rejected the redirect URI. Add the exact callback URL shown in diagnostics to the OAuth client’s Authorized redirect URIs.";
  }
  return `Google returned: ${googleError}`;
}

/**
 * Query string for a redirect. Values are already safe (no secrets).
 */
export function diagnosticQuery(
  diag: OAuthDiagnostic,
  extra: {
    step: OAuthStep;
    consent?: string;
    tokenExchange?: "ok" | "fail" | "not_reached";
    propertyDiscovery?: "ok" | "fail" | "not_reached";
    error?: string;
  },
): string {
  const params = new URLSearchParams();
  params.set("google_diag", "1");
  params.set("oauth_step", extra.step);
  params.set("oauth_configured", diag.environmentConfigured ? "yes" : "no");
  params.set("oauth_redirect", diag.redirectUri);
  if (diag.clientIdSuffix) params.set("oauth_client", diag.clientIdSuffix);
  if (diag.clientIdMatchesProduction !== null) {
    params.set(
      "oauth_client_match",
      diag.clientIdMatchesProduction ? "yes" : "no",
    );
  }
  if (extra.consent) params.set("oauth_consent", extra.consent);
  if (extra.tokenExchange) params.set("oauth_token", extra.tokenExchange);
  if (extra.propertyDiscovery) {
    params.set("oauth_properties", extra.propertyDiscovery);
  }
  if (extra.error) params.set("google_error", extra.error.slice(0, 300));
  return params.toString();
}

export type SafeDiagnosticView = {
  environmentConfigured: boolean;
  clientIdSuffix: string | null;
  clientIdMatch: boolean | null;
  redirectUri: string;
  redirectUriMatch: boolean | null;
  consent: string | null;
  callbackReceived: boolean;
  tokenExchange: string | null;
  propertyDiscovery: string | null;
  step: string | null;
  error: string | null;
};

export function parseDiagnosticParams(
  params: URLSearchParams,
): SafeDiagnosticView | null {
  if (params.get("google_diag") !== "1" && !params.get("google_error")) {
    return null;
  }
  return {
    environmentConfigured: params.get("oauth_configured") === "yes",
    clientIdSuffix: params.get("oauth_client"),
    clientIdMatch:
      params.get("oauth_client_match") === null
        ? null
        : params.get("oauth_client_match") === "yes",
    redirectUri: params.get("oauth_redirect") ?? "",
    redirectUriMatch:
      params.get("oauth_redirect_match") === null &&
      params.get("oauth_redirect") == null
        ? null
        : params.get("oauth_redirect") === PRODUCTION_REDIRECT_URI,
    consent: params.get("oauth_consent"),
    callbackReceived: params.get("oauth_step") === "callback" || params.has("oauth_token"),
    tokenExchange: params.get("oauth_token"),
    propertyDiscovery: params.get("oauth_properties"),
    step: params.get("oauth_step"),
    error: params.get("google_error") ?? params.get("error"),
  };
}
