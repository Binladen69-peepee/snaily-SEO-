import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveGoogleAccount } from "@/lib/google/account";
import {
  buildOAuthDiagnostic,
  consentErrorMessage,
  diagnosticQuery,
} from "@/lib/google/diagnostics";
import {
  decodeState,
  exchangeCode,
  fetchAccountEmail,
  originOf,
} from "@/lib/google/oauth";
import { ensureSettings } from "@/lib/settings";

/**
 * Completes Google OAuth for sign-in AND for Connect Google (GSC/GA4).
 *
 * Connect (intent=connect|drive) attaches tokens to the signed-in session.
 * Login creates a session only when the Google email already belongs to a user.
 */
export async function GET(req: Request) {
  await ensureSettings();
  const origin = originOf(req);
  const diag = buildOAuthDiagnostic(origin);

  const fail = (
    path: string,
    extra: Parameters<typeof diagnosticQuery>[1],
  ) => {
    const res = NextResponse.redirect(
      `${origin}${path}?${diagnosticQuery(diag, extra)}`,
    );
    res.cookies.set("google_oauth_nonce", "", { maxAge: 0, path: "/" });
    return res;
  };

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");

  const state = rawState ? decodeState(rawState) : null;
  const nextPath =
    state?.next && /^\/(?!\/)/.test(state.next) ? state.next : "/login";
  const errorPath =
    state?.intent === "login" || !state?.intent ? "/login" : nextPath;

  if (error !== null) {
    return fail(errorPath, {
      step: "consent",
      consent: "denied",
      tokenExchange: "not_reached",
      error: consentErrorMessage(error),
    });
  }

  if (code === null || rawState === null) {
    return fail(errorPath, {
      step: "callback",
      consent: "incomplete",
      tokenExchange: "not_reached",
      error:
        "Google sign-in was incomplete — no authorization code was returned.",
    });
  }

  const nonce = (await cookies()).get("google_oauth_nonce")?.value;

  if (state === null || nonce === undefined || state.nonce !== nonce) {
    return fail(errorPath, {
      step: "callback",
      consent: "ok",
      tokenExchange: "not_reached",
      error: "Sign-in link expired. Please try again.",
    });
  }

  let email: string | null;
  let tokens: Awaited<ReturnType<typeof exchangeCode>>;

  try {
    tokens = await exchangeCode(code, origin);
    email = await fetchAccountEmail(tokens.access_token ?? "", origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google sign-in failed.";
    const friendly = /invalid_client|unauthorized_client/i.test(message)
      ? "OAuth client rejected during token exchange. The runtime GOOGLE_CLIENT_ID / SECRET do not match the client that started this flow, or the secret was rotated."
      : /redirect_uri/i.test(message)
        ? `Token exchange failed because the redirect URI did not match. This request used ${diag.redirectUri}.`
        : message;
    return fail(errorPath, {
      step: "token_exchange",
      consent: "ok",
      tokenExchange: "fail",
      error: friendly,
    });
  }

  if (email === null || email.trim() === "") {
    return fail(errorPath, {
      step: "token_exchange",
      consent: "ok",
      tokenExchange: "ok",
      error:
        "Google did not share an email address. Grant the email scope and try again.",
    });
  }

  const succeed = (land: string) => {
    const ok = new URLSearchParams({
      google: "connected",
      google_diag: "1",
      oauth_step: "account_saved",
      oauth_configured: "yes",
      oauth_consent: "ok",
      oauth_token: "ok",
      oauth_client: diag.clientIdSuffix ?? "",
      oauth_redirect: diag.redirectUri,
    });
    const res = NextResponse.redirect(`${origin}${land}?${ok.toString()}`);
    res.cookies.set("google_oauth_nonce", "", { maxAge: 0, path: "/" });
    return res;
  };

  if (state.intent === "drive" || state.intent === "connect") {
    const session = await getSession();
    if (!session) {
      return fail("/login", {
        step: "callback",
        consent: "ok",
        tokenExchange: "ok",
        error: "Sign in first, then connect Google.",
      });
    }
    try {
      await saveGoogleAccount(session.userId, email.toLowerCase(), tokens);
    } catch (err) {
      return fail(state.next ?? "/integrations", {
        step: "account_saved",
        consent: "ok",
        tokenExchange: "ok",
        error:
          err instanceof Error ? err.message : "Could not store Google access.",
      });
    }
    return succeed(state.next ?? "/integrations");
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    return fail("/login", {
      step: "account_saved",
      consent: "ok",
      tokenExchange: "ok",
      error: `Not authorized — ${email} does not have access to this tool. Ask the owner to add you first.`,
    });
  }

  try {
    await saveGoogleAccount(user.id, email.toLowerCase(), tokens);
  } catch (err) {
    return fail("/login", {
      step: "account_saved",
      consent: "ok",
      tokenExchange: "ok",
      error:
        err instanceof Error ? err.message : "Could not store Google access.",
    });
  }

  await createSession({
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  return succeed(state.next ?? "/keywords");
}
