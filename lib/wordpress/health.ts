import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/google/token-crypto";
import { verifyConnection, WordPressError } from "@/lib/wordpress/client";

export { isPluginUnavailable } from "@/lib/wordpress/unavailable";

export function describeUnavailable(err: unknown): string {
  if (err instanceof WordPressError) return err.message;
  if (err instanceof Error && err.message.trim() !== "") return err.message;
  return "The WordPress connector did not respond.";
}

/** Persist a live failure so the rest of the app stops looking connected. */
export async function recordConnectionError(
  projectId: string,
  err: unknown,
): Promise<void> {
  await prisma.wordPressConnection.updateMany({
    where: { projectId },
    data: {
      lastError: describeUnavailable(err),
      healthCheckedAt: new Date(),
    },
  });
}

export async function clearConnectionError(projectId: string): Promise<void> {
  await prisma.wordPressConnection.updateMany({
    where: { projectId },
    data: { lastError: null, healthCheckedAt: new Date() },
  });
}

/**
 * Live ping. Updates lastError on the stored connection.
 *
 * Returns not_configured when no credentials exist. Never throws — callers
 * want a health enum, not a stack trace.
 */
export async function probeConnection(
  projectId: string,
): Promise<"connected" | "connection_lost" | "not_configured"> {
  const row = await prisma.wordPressConnection.findUnique({
    where: { projectId },
    select: { siteUrl: true, token: true },
  });
  if (!row) return "not_configured";

  let token: string;
  try {
    token = decryptToken(row.token);
  } catch {
    await recordConnectionError(
      projectId,
      new WordPressError(
        "Stored credentials could not be read. Reconnect the site.",
        true,
        "auth",
      ),
    );
    return "connection_lost";
  }

  try {
    await verifyConnection(row.siteUrl, token);
    await clearConnectionError(projectId);
    return "connected";
  } catch (err) {
    await recordConnectionError(projectId, err);
    return "connection_lost";
  }
}
