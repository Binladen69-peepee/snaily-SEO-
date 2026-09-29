/**
 * Hostnames / IPs that must never be fetched on a user's behalf (SSRF).
 *
 * Hostname checks are sync and Edge-safe. DNS resolution lives in
 * `assert-public-url.ts` (Node only).
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "kubernetes",
  "ip6-localhost",
  "ip6-loopback",
]);

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.+$/, "");
  if (h === "") return true;
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  if (isIpv4(h)) return isBlockedIpv4(h);
  if (h.includes(":")) return isBlockedIpv6(h);
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase();
  if (isIpv4(trimmed)) return isBlockedIpv4(trimmed);
  return isBlockedIpv6(trimmed);
}

function isIpv4(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const h = ip.replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return true;

  const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);

  // Unique local (fc00::/7) and link-local (fe80::/10) — only when this is
  // actually an IPv6 literal. `facebook.com` starts with "fc" and must not
  // match the old prefix check.
  const compact = h.replace(/:/g, "");
  if (h.includes(":")) {
    if (/^f[cd]/i.test(compact)) return true;
    if (/^fe[89ab]/i.test(compact)) return true;
  }
  return false;
}

export function assertHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be fetched.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("URLs with credentials cannot be fetched.");
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error("This host cannot be fetched.");
  }
  return parsed;
}
