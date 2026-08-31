import type { OAuth2Client } from "google-auth-library";

import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/google/token-crypto";
import { createOAuth2Client } from "@/lib/google/oauth";
import { ensureSettings } from "@/lib/settings";

/**
 * The signed-in user's Google identity.
 *
 * One record per user, authorised once at sign-in with every scope the app
 * needs. Projects store *which property* they point at; they never store
 * credentials. That is why linking a second project asks for nothing — the
 * token already covers it.
 *
 * Tokens are encrypted at rest and only ever decrypted inside this module.
 * Nothing here is exported to the client.
 */

/** Refresh a little early so a long request cannot expire mid-flight. */
const EXPIRY_SKEW_MS = 60_000;

export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  scopes: string;
};

export async function saveGoogleAccount(
  userId: string,
  email: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    scope?: string | null;
  },
): Promise<void> {
  if (!tokens.access_token) {
    throw new Error("Google did not return an access token");
  }

  const existing = await prisma.googleAccount.findUnique({ where: { userId } });

  /*
   * Google only issues a refresh token on the first consent. On a repeat
   * sign-in the field is absent, so the stored one is kept — dropping it would
   * silently break every future sync.
   */
  const refresh = tokens.refresh_token
    ? encryptToken(tokens.refresh_token)
    : existing?.refreshTokenEncrypted;

  if (!refresh) {
    throw new Error(
      "Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and sign in again.",
    );
  }

  const data = {
    email,
    accessTokenEncrypted: encryptToken(tokens.access_token),
    refreshTokenEncrypted: refresh,
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scopes: grantedScopes(tokens.scope, existing?.scopes),
    lastError: null,
  };

  await prisma.googleAccount.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/**
 * The scopes this token actually carries.
 *
 * These used to be unioned with whatever was stored before, on the theory that
 * consent only ever adds. It does not. Signing in again issues a login-scoped
 * token, and pointing the app at a different OAuth client starts from nothing
 * — but the union went on claiming Drive from a grant that no longer existed.
 * `hasDrive` then reported a permission the token did not have, so the editor
 * skipped its connect redirect, called Drive, and got a 403 the author had no
 * way to act on.
 *
 * Every consent URL asks for LOGIN_SCOPES plus whatever else it needs and sets
 * `include_granted_scopes`, so the response lists everything the client holds.
 * Trust it. The stored value is only a fallback for a response that omits
 * `scope` altogether.
 */
function grantedScopes(
  incoming: string | null | undefined,
  stored: string | undefined,
): string {
  const granted = new Set(
    (incoming ?? "")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );

  if (granted.size > 0) return [...granted].join(" ");
  return stored ?? "";
}

/**
 * An OAuth client with a live access token, refreshing it when needed.
 *
 * Returns null when the user has never connected Google. Throws when the
 * refresh token has been revoked, which is the only case that genuinely
 * requires signing in again.
 */
export async function getGoogleClient(
  userId: string,
  origin: string,
): Promise<OAuth2Client | null> {
  await ensureSettings();
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account) return null;

  const client = createOAuth2Client(origin);
  const expired =
    account.tokenExpiresAt !== null &&
    account.tokenExpiresAt.getTime() - EXPIRY_SKEW_MS < Date.now();

  client.setCredentials({
    access_token: decryptToken(account.accessTokenEncrypted),
    refresh_token: decryptToken(account.refreshTokenEncrypted),
    expiry_date: account.tokenExpiresAt?.getTime() ?? null,
  });

  if (!expired) return client;

  try {
    const { credentials } = await client.refreshAccessToken();

    await prisma.googleAccount.update({
      where: { userId },
      data: {
        accessTokenEncrypted: encryptToken(credentials.access_token ?? ""),
        tokenExpiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : null,
        ...(credentials.refresh_token
          ? { refreshTokenEncrypted: encryptToken(credentials.refresh_token) }
          : {}),
        lastError: null,
      },
    });

    client.setCredentials(credentials);
    return client;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Google refused to refresh access";

    await prisma.googleAccount.update({
      where: { userId },
      data: { lastError: message },
    });

    throw new Error(
      `Google access expired and could not be renewed. Sign in with Google again. (${message})`,
    );
  }
}

/** Safe summary for the UI — never includes tokens. */
export type GoogleAccountPublic = {
  email: string;
  connected: boolean;
  hasSearchConsole: boolean;
  hasAnalytics: boolean;
  hasDrive: boolean;
  lastError: string | null;
};

export async function getGoogleAccountPublic(
  userId: string,
): Promise<GoogleAccountPublic | null> {
  const account = await prisma.googleAccount.findUnique({
    where: { userId },
    select: { email: true, scopes: true, lastError: true },
  });
  if (!account) return null;

  return {
    email: account.email,
    connected: true,
    hasSearchConsole: account.scopes.includes("webmasters"),
    hasAnalytics: account.scopes.includes("analytics"),
    // Matches drive.file and any wider Drive scope, and nothing that merely
    // contains the word.
    hasDrive: account.scopes.includes("auth/drive"),
    lastError: account.lastError,
  };
}
