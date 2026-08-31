import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getGoogleAccountPublic } from "@/lib/google/account";
import {
  buildOAuthDiagnostic,
  diagnosticQuery,
} from "@/lib/google/diagnostics";
import {
  encodeState,
  getAuthUrl,
  googleIsConfigured,
  originOf,
} from "@/lib/google/oauth";
import { ensureSettings } from "@/lib/settings";

/**
 * Starts Google OAuth.
 *
 * Signed-out visitors: this is sign-in. The callback only creates a session
 * when the Google email already belongs to a user.
 *
 * Signed-in visitors (Connect Google on Integrations / setup): this attaches
 * Search Console and Analytics tokens to the current session. The Google
 * email does not have to match the login email.
 */
export async function GET(req: Request) {
  await ensureSettings();
  const origin = originOf(req);
  const diag = buildOAuthDiagnostic(origin);

  if (!googleIsConfigured()) {
    const dest = "/login";
    return NextResponse.redirect(
      `${origin}${dest}?${diagnosticQuery(diag, {
        step: "start",
        error: "Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      })}`,
    );
  }

  const url = new URL(req.url);
  const rawNext = url.searchParams.get("next") ?? "";
  const next = /^\/(?!\/)/.test(rawNext) ? rawNext : "/keywords";

  const session = await getSession();
  const intent = session ? "connect" : "login";
  const nonce = randomBytes(16).toString("hex");
  const state = encodeState({ nonce, next, intent });

  let loginHint: string | undefined;
  if (session) {
    const existing = await getGoogleAccountPublic(session.userId);
    loginHint = existing?.email;
  }

  const res = NextResponse.redirect(getAuthUrl(state, origin, [], loginHint));

  res.cookies.set("google_oauth_nonce", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 600,
  });

  return res;
}
