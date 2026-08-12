/**
 * Runs once before the server handles any request.
 *
 * Hydrates owner-managed keys from the database into `process.env`, so every
 * existing synchronous `process.env.X` read picks up a rotated key without a
 * single call site changing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadSettings } = await import("@/lib/settings");
  await loadSettings();
  const { expireStaleAudits } = await import("@/lib/audit/stale");
  await expireStaleAudits();
}
