import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { getSetupSnapshot, wordpressHealthFromRow } from "@/lib/setup/state";
import { verifyConnection, WordPressError } from "@/lib/wordpress/client";
import { PLUGIN_VERSION } from "@/lib/wordpress/plugin";
import { getCredentials } from "@/lib/wordpress/sync";

/**
 * Live check of the WordPress connector.
 *
 * Deliberately not read from the cached `WordPressConnection` row: the point is
 * to confirm what the site is answering *right now*, and a cached value would
 * happily report success for a plugin that was never actually replaced.
 *
 * This endpoint has two consumers with different needs — the guided update
 * dialog wants the installed version, the setup panel wants a fresh snapshot —
 * so it returns both. They previously disagreed: the route returned only
 * version fields while the panel checked for `snapshot`, so `!data.snapshot`
 * was always true and "Could not verify the connection" fired on every call,
 * including when the plugin was healthy.
 */

const schema = z.object({ projectId: z.string().min(1) });

/**
 * Why verification failed, in terms the UI can act on.
 *
 * A generic "could not verify" is useless: reinstalling the plugin fixes
 * PLUGIN_NOT_ACTIVE and does nothing for DOMAIN_MISMATCH.
 */
export type VerifyReason =
  | "OK"
  | "INVALID_SECRET"
  | "PLUGIN_NOT_ACTIVE"
  | "ENDPOINT_UNREACHABLE"
  | "DOMAIN_MISMATCH"
  | "AUTH_FAILED"
  | "MALFORMED_RESPONSE"
  | "OUTDATED_PLUGIN"
  | "NOT_CONFIGURED"
  | "SERVER_ERROR";

/** What the operator should do next, per reason. Never leaks the secret. */
const GUIDANCE: Record<VerifyReason, string> = {
  OK: "The plugin is active and answering.",
  INVALID_SECRET:
    "The connector responded, but the token does not match this site. Copy it again from Settings → Snaily SEO.",
  PLUGIN_NOT_ACTIVE:
    "The site answered, but the connector routes are missing. Install and activate the plugin, then retry.",
  ENDPOINT_UNREACHABLE:
    "The site could not be reached. Check it is online and that the REST API is not blocked.",
  DOMAIN_MISMATCH:
    "The connector answered from a different domain than this project. Check the project URL matches the site.",
  AUTH_FAILED:
    "The site rejected the request. A security plugin or host firewall may be blocking the REST API.",
  MALFORMED_RESPONSE:
    "The site replied with something that is not valid connector data. A plugin may be rewriting REST responses.",
  OUTDATED_PLUGIN:
    "The plugin is older than this app expects. Download the latest zip and replace it.",
  NOT_CONFIGURED:
    "No connector token is stored for this project yet. Paste one to connect.",
  SERVER_ERROR: "Something failed on our side while checking. Try again.",
};

/** Compares dotted versions without assuming equal segment counts. */
function isAtLeast(installed: string, required: string): boolean {
  const a = installed.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = required.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Maps a thrown connector error onto a reason the UI can act on. */
function reasonFor(err: unknown): VerifyReason {
  if (!(err instanceof WordPressError)) return "SERVER_ERROR";
  switch (err.kind) {
    case "network":
      return "ENDPOINT_UNREACHABLE";
    case "auth":
      // The plugin distinguishes a bad token from a stripped header; the
      // message carries which, because the status code is 403 for both.
      return /token does not match|bad_token|invalid connector token/i.test(err.message)
        ? "INVALID_SECRET"
        : "AUTH_FAILED";
    case "plugin_missing":
      return "PLUGIN_NOT_ACTIVE";
    case "route_missing":
      return "OUTDATED_PLUGIN";
    default:
      return /valid data|not valid|rewriting/i.test(err.message)
        ? "MALFORMED_RESPONSE"
        : "SERVER_ERROR";
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success || !isValidId(parsed.data.projectId)) {
    return NextResponse.json({ error: "Project required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, userId: session.userId },
    select: { id: true, url: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  /** Always returns 200 with a snapshot — a failed check is data, not an HTTP error. */
  const respond = async (
    reason: VerifyReason,
    extra: Record<string, unknown> = {},
  ) => {
    const row = await prisma.wordPressConnection.findUnique({
      where: { projectId: project.id },
      select: { lastError: true },
    });
    return NextResponse.json({
      ok: reason === "OK",
      reason,
      message: GUIDANCE[reason],
      health: reason === "OK" ? "connected" : wordpressHealthFromRow(row),
      snapshot: await getSetupSnapshot(project.id),
      expected: PLUGIN_VERSION,
      ...extra,
    });
  };

  const creds = await getCredentials(project.id);
  if (!creds) return respond("NOT_CONFIGURED", { installed: null });

  try {
    const site = await verifyConnection(creds.siteUrl, creds.token);
    const installed = site.pluginVersion === "" ? "unknown" : site.pluginVersion;

    /*
     * The connector answered, but from somewhere else. Usually a project URL
     * left pointing at staging after a migration — reinstalling would not fix
     * it, so it must not be reported as a plugin problem.
     */
    const answering = hostOf(site.url);
    const expectedHost = hostOf(creds.siteUrl) || hostOf(project.url);
    if (answering !== "" && expectedHost !== "" && answering !== expectedHost) {
      return respond("DOMAIN_MISMATCH", {
        installed,
        answeringHost: answering,
        expectedHost,
      });
    }

    if (installed !== "unknown" && !isAtLeast(installed, PLUGIN_VERSION)) {
      return respond("OUTDATED_PLUGIN", { installed });
    }

    // A clean ping proves the plugin is live, so clear any stale error.
    await prisma.wordPressConnection.updateMany({
      where: { projectId: project.id },
      data: { lastError: null },
    });

    return respond("OK", { installed, siteName: site.name });
  } catch (err) {
    const reason = reasonFor(err);
    // Diagnostic only. Never the token, never headers, never the site payload.
    console.error("[wordpress verify]", {
      projectId: project.id,
      reason,
      kind: err instanceof WordPressError ? err.kind : "unknown",
    });
    return respond(reason, { installed: null });
  }
}
