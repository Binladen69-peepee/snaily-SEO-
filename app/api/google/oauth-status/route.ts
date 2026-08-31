import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { buildOAuthDiagnostic } from "@/lib/google/diagnostics";
import { LOGIN_SCOPES } from "@/lib/google/types";
import { originOf } from "@/lib/google/oauth";
import { ensureSettings } from "@/lib/settings";

/**
 * Safe OAuth configuration snapshot for the Connect Google UI.
 * Never includes secrets or tokens.
 */
export async function GET(req: Request) {
  await ensureSettings();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = originOf(req);
  const diag = buildOAuthDiagnostic(origin);

  return NextResponse.json({
    environmentConfigured: diag.environmentConfigured,
    settingsHydrated: diag.settingsHydrated,
    clientIdSuffix: diag.clientIdSuffix,
    clientIdMatchesProduction: diag.clientIdMatchesProduction,
    redirectUri: diag.redirectUri,
    redirectUriMatchesProduction: diag.redirectUriMatchesProduction,
    scopes: LOGIN_SCOPES,
    host: diag.host,
  });
}
