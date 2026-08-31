import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getGoogleClient } from "@/lib/google/account";
import {
  listAnalyticsProperties,
  listSearchConsoleSites,
} from "@/lib/google/client";
import { friendlyGoogleError } from "@/lib/google/errors";
import { originOf } from "@/lib/google/oauth";
import { ensureSettings } from "@/lib/settings";

/**
 * Properties the signed-in Google account can see.
 *
 * Both services come from the one grant made at sign-in, so this needs no
 * project context and never triggers another consent screen.
 */
export async function GET(req: Request) {
  await ensureSettings();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let client;
  try {
    client = await getGoogleClient(session.userId, originOf(req));
  } catch (err) {
    const friendly = friendlyGoogleError(
      err instanceof Error ? err.message : "Google access failed",
    );
    return NextResponse.json(
      { error: `${friendly.title}. ${friendly.detail}`, needsGoogle: true },
      { status: 502 },
    );
  }

  if (client === null) {
    return NextResponse.json(
      { error: "Sign in with Google to link a property.", needsGoogle: true },
      { status: 409 },
    );
  }

  const [gsc, ga4] = await Promise.allSettled([
    listSearchConsoleSites(client),
    listAnalyticsProperties(client),
  ]);

  const reason = (r: PromiseSettledResult<unknown>) => {
    if (r.status !== "rejected") return null;
    const raw = r.reason instanceof Error ? r.reason.message : "Google refused the request";
    const friendly = friendlyGoogleError(raw);
    return `${friendly.title}. ${friendly.detail}`;
  };

  return NextResponse.json({
    searchConsole: gsc.status === "fulfilled" ? gsc.value : [],
    analytics: ga4.status === "fulfilled" ? ga4.value : [],
    searchConsoleError: reason(gsc),
    analyticsError: reason(ga4),
    propertyDiscovery:
      gsc.status === "fulfilled" || ga4.status === "fulfilled" ? "ok" : "fail",
  });
}
