import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getGoogleClient } from "@/lib/google/account";
import {
  listAnalyticsProperties,
  listSearchConsoleSites,
} from "@/lib/google/client";
import { originOf } from "@/lib/google/oauth";

/**
 * Properties the signed-in Google account can see.
 *
 * Both services come from the one grant made at sign-in, so this needs no
 * project context and never triggers another consent screen.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let client;
  try {
    client = await getGoogleClient(session.userId, originOf(req));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Google access failed" },
      { status: 502 },
    );
  }

  if (client === null) {
    return NextResponse.json(
      { error: "Sign in with Google to link a property.", needsGoogle: true },
      { status: 409 },
    );
  }

  // One failing service must not hide the other — Search Console and GA4 are
  // enabled independently in Google Cloud.
  const [gsc, ga4] = await Promise.allSettled([
    listSearchConsoleSites(client),
    listAnalyticsProperties(client),
  ]);

  const reason = (r: PromiseSettledResult<unknown>) =>
    r.status === "rejected"
      ? r.reason instanceof Error
        ? r.reason.message
        : "Google refused the request"
      : null;

  return NextResponse.json({
    searchConsole: gsc.status === "fulfilled" ? gsc.value : [],
    analytics: ga4.status === "fulfilled" ? ga4.value : [],
    searchConsoleError: reason(gsc),
    analyticsError: reason(ga4),
  });
}
