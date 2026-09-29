/**
 * Structured JSON logs — one line per event, safe to grep in Vercel.
 * Never pass secrets, tokens, or raw provider credentials.
 */
export function log(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...fields,
    }),
  );
}
