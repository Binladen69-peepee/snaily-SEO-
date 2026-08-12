import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveGoogleAccount } from "@/lib/google/account";
import {
  decodeState,
  exchangeCode,
  fetchAccountEmail,
  originOf,
} from "@/lib/google/oauth";

/**
 * Completes "Continue with Google".
 *
 * Lives at /api/google/callback because that path is already registered in the
 * Google Cloud OAuth client for both localhost and production. Moving it would
 * mean re-editing the console before anyone could sign in.
 *
 * Authorisation rule: a session is created only when the Google email already
 * belongs to a user in this database. Accounts are never created here — this
 * is a private, self-hosted tool, and an open Google button that provisioned
 * accounts would let anyone with a Google login in.
 */
export async function GET(req: Request) {
  const origin = originOf(req);

  /** Always clears the nonce on the way out, so a code cannot be replayed. */
  const done = (params: string) => {
    const res = NextResponse.redirect(`${origin}/login?${params}`);
    res.cookies.set("google_oauth_nonce", "", { maxAge: 0, path: "/" });
    return res;
  };

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");

  if (error !== null) {
    return done(
      `error=${encodeURIComponent(
        error === "access_denied"
          ? "You cancelled Google sign-in."
          : `Google returned: ${error}`,
      )}`,
    );
  }

  if (code === null || rawState === null) {
    return done(`error=${encodeURIComponent("Google sign-in was incomplete.")}`);
  }

  const state = decodeState(rawState);
  const nonce = (await cookies()).get("google_oauth_nonce")?.value;

  if (state === null || nonce === undefined || state.nonce !== nonce) {
    return done(
      `error=${encodeURIComponent("Sign-in link expired. Please try again.")}`,
    );
  }

  let email: string | null;
  let tokens: Awaited<ReturnType<typeof exchangeCode>>;

  try {
    tokens = await exchangeCode(code, origin);
    email = await fetchAccountEmail(tokens.access_token ?? "", origin);
  } catch (err) {
    return done(
      `error=${encodeURIComponent(
        err instanceof Error ? err.message : "Google sign-in failed.",
      )}`,
    );
  }

  if (email === null || email.trim() === "") {
    return done(
      `error=${encodeURIComponent("Google did not share an email address.")}`,
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    return done(
      `error=${encodeURIComponent(
        `Not authorized — ${email} does not have access to this tool. Ask the owner to add you first.`,
      )}`,
    );
  }

  try {
    await saveGoogleAccount(user.id, email.toLowerCase(), tokens);
  } catch (err) {
    return done(
      `error=${encodeURIComponent(
        err instanceof Error ? err.message : "Could not store Google access.",
      )}`,
    );
  }

  await createSession({
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  const res = NextResponse.redirect(`${origin}${state.next ?? "/keywords"}`);
  res.cookies.set("google_oauth_nonce", "", { maxAge: 0, path: "/" });
  return res;
}
