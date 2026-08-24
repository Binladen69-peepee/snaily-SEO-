/*
 * Named token-crypto, not crypto: a module called "crypto" sitting beside an
 * import of "crypto" is ambiguous, and Turbopack resolves it to this file and
 * fails the dev server outright. Spelling it "node:crypto" fixes dev but breaks
 * the production webpack build, which reaches this through instrumentation.ts
 * where the node: scheme is unhandled. Renaming the file satisfies both.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * AES-256-GCM for OAuth tokens at rest. The key is derived from AUTH_SECRET so
 * there is no extra env var to manage or lose.
 */
function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHash("sha256").update(secret).digest();
}

/** Format: iv:authTag:ciphertext, all hex. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptToken(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Invalid encrypted token");

  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
