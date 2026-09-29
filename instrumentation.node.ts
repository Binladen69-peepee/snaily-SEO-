/**
 * Node-only startup work. Kept out of `instrumentation.ts` so the Edge
 * compiler (middleware) never tries to resolve `crypto` / Prisma.
 */
export async function registerNode() {
  const { loadSettings } = await import("@/lib/settings");
  await loadSettings();
  const { expireStaleAudits } = await import("@/lib/audit/stale");
  await expireStaleAudits();
}
