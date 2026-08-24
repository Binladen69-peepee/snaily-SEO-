import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { DRIVE_SCOPES } from "@/lib/google/types";
import {
  encodeState,
  getAuthUrl,
  googleIsConfigured,
  originOf,
} from "@/lib/google/oauth";

/**
 * Starts incremental Google Drive consent for Drafter exports.
 *
 * The author is already signed in. This only adds Drive scopes onto the
 * existing Google account and returns them to the article they came from.
 */
export async function GET(req: Request) {
  const origin = originOf(req);
  const session = await getSession();

  if (!session) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Sign in first, then connect Google Drive.")}`,
    );
  }

  if (!googleIsConfigured()) {
    return NextResponse.redirect(
      `${origin}/content-assistant?drive=error`,
    );
  }

  const url = new URL(req.url);
  const rawNext = url.searchParams.get("next") ?? "/content-assistant";
  const next = /^\/(?!\/)/.test(rawNext) ? rawNext : "/content-assistant";

  const nonce = randomBytes(16).toString("hex");
  const state = encodeState({ nonce, next, intent: "drive" });

  const res = NextResponse.redirect(getAuthUrl(state, origin, DRIVE_SCOPES));
  res.cookies.set("google_oauth_nonce", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 600,
  });
  return res;
}
