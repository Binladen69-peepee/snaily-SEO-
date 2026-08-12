import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import {
  encodeState,
  getAuthUrl,
  googleIsConfigured,
  originOf,
} from "@/lib/google/oauth";

/**
 * Starts "Continue with Google".
 *
 * Open to signed-out visitors by design — this *is* the sign-in. Whether the
 * person is allowed in is decided in the callback, once Google has told us
 * which email they actually control.
 */
export function GET(req: Request) {
  const origin = originOf(req);

  if (!googleIsConfigured()) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Google sign-in is not configured on this server.")}`,
    );
  }

  const url = new URL(req.url);
  const rawNext = url.searchParams.get("next") ?? "";
  // Only same-site paths, so the parameter cannot be used as an open redirect.
  const next = /^\/(?!\/)/.test(rawNext) ? rawNext : "/keywords";

  const nonce = randomBytes(16).toString("hex");
  const state = encodeState({ nonce, next });

  const res = NextResponse.redirect(getAuthUrl(state, origin));

  // Single-use, checked in the callback to block a replayed code.
  res.cookies.set("google_oauth_nonce", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 600,
  });

  return res;
}
