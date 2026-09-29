/**
 * Runs once before the server handles any request.
 *
 * Hydrates owner-managed keys from the database into `process.env`, so every
 * existing synchronous `process.env.X` read picks up a rotated key without a
 * single call site changing.
 *
 * The Node work lives in `instrumentation.node.ts` so middleware's Edge
 * compile does not follow imports into `crypto` / Prisma.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNode } = await import("./instrumentation.node");
  await registerNode();
}
