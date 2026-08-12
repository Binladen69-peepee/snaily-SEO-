import { google } from "googleapis";

import { LOGIN_SCOPES } from "@/lib/google/types";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set — add it to .env.local`);
  return v;
}

export function googleIsConfigured(): boolean {
  return (
    !!process.env.GOOGLE_CLIENT_ID?.trim() &&
    !!process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

/**
 * The public origin of the request that is actually being served.
 *
 * Derived from proxy headers, never from a hardcoded value or an env var, so
 * localhost, preview deployments and production each get their own correct
 * callback with no configuration. Vercel terminates TLS at the edge, so
 * `req.url` can report http/an internal host — the forwarded headers are the
 * only trustworthy source of the URL the browser actually used.
 */
export function originOf(req: Request): string {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";

  if (host !== "") {
    const proto =
      req.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https");
    return `${proto}://${host}`;
  }

  return new URL(req.url).origin;
}

/**
 * Callback URL for this request's origin.
 *
 * GOOGLE_REDIRECT_URI is honoured only when it points at the same origin we are
 * currently serving. That keeps it usable as a deliberate override (custom
 * domain, proxy) while making it impossible for a stale value — say a leftover
 * localhost URL — to be sent to Google from production.
 */
export function getRedirectUri(origin: string): string {
  const derived = `${origin}/api/google/callback`;
  const override = process.env.GOOGLE_REDIRECT_URI?.trim();

  if (override) {
    try {
      if (new URL(override).origin === origin) return override;
    } catch {
      // Malformed override — fall through to the derived URL.
    }
  }

  return derived;
}

export function createOAuth2Client(origin: string) {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    getRedirectUri(origin),
  );
}

/**
 * Sign-in state. There is no userId here: the whole point of the flow is that
 * we do not know who is signing in until Google tells us their email.
 */
export type OAuthState = {
  nonce: string;
  /** Where to land after a successful sign-in. */
  next?: string;
};

export function encodeState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeState(raw: string): OAuthState | null {
  try {
    const p = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as OAuthState;
    if (typeof p.nonce !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

export function getAuthUrl(state: string, origin: string): string {
  return createOAuth2Client(origin).generateAuthUrl({
    access_type: "offline",
    // Always prompt so Google reliably returns a refresh token, even on re-auth.
    prompt: "consent",
    include_granted_scopes: true,
    scope: LOGIN_SCOPES,
    state,
  });
}

export async function exchangeCode(code: string, origin: string) {
  const { tokens } = await createOAuth2Client(origin).getToken(code);
  if (!tokens.access_token) {
    throw new Error("Google did not return an access token");
  }
  return tokens;
}

export async function fetchAccountEmail(
  accessToken: string,
  origin: string,
): Promise<string | null> {
  const client = createOAuth2Client(origin);
  client.setCredentials({ access_token: accessToken });
  const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  return data.email ?? null;
}
