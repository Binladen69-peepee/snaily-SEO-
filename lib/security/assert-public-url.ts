import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { assertHttpUrl, isBlockedHostname, isBlockedIp } from "@/lib/security/private-host";

/**
 * Rejects loopback / private / link-local targets, including hostnames that
 * resolve to them (DNS rebinding). Set ALLOW_PRIVATE_CRAWL=1 only on a
 * self-hosted install that is meant to audit local sites.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  if (process.env.ALLOW_PRIVATE_CRAWL === "1") {
    return new URL(raw);
  }

  const parsed = assertHttpUrl(raw);

  if (isIP(parsed.hostname)) {
    if (isBlockedIp(parsed.hostname)) {
      throw new Error("This host cannot be fetched.");
    }
    return parsed;
  }

  try {
    const { address } = await lookup(parsed.hostname);
    if (isBlockedIp(address) || isBlockedHostname(address)) {
      throw new Error("This host cannot be fetched.");
    }
  } catch (err) {
    if (err instanceof Error && err.message === "This host cannot be fetched.") {
      throw err;
    }
    // DNS failure is handled by the later fetch; do not fail closed here or
    // every typo becomes an SSRF error instead of "could not reach".
  }

  return parsed;
}
