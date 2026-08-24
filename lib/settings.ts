import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/google/token-crypto";

/**
 * Owner-managed configuration.
 *
 * Keys normally arrive as environment variables, which means rotating an
 * expired production key requires a redeploy. These override the environment
 * from the database, so the owner can paste a new key and have it take effect
 * without touching Vercel.
 *
 * Values are encrypted at rest with the same key as OAuth tokens, and are only
 * ever decrypted on the server. The UI receives a masked preview, never the
 * secret itself.
 */

export type SettingKey =
  | "SERPAPI_KEY"
  | "OPENPAGERANK_API_KEY"
  | "CRAWLGRAPH_API_KEY"
  | "GROK_API_KEY"
  | "GROK_MODEL"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET";

export type SettingSpec = {
  key: SettingKey;
  label: string;
  description: string;
  /** Model ids and client ids are not secret; only mask what needs masking. */
  secret: boolean;
  placeholder: string;
};

export const SETTINGS: SettingSpec[] = [
  {
    key: "SERPAPI_KEY",
    label: "SerpApi key",
    description:
      "Powers live Google results, rank checks and competitor citations. Free tier is 250 searches a month.",
    secret: true,
    placeholder: "Paste a new key to replace the current one",
  },
  {
    key: "OPENPAGERANK_API_KEY",
    label: "OpenPageRank key",
    description:
      "Free link-graph rank from the Common Crawl web graph — the main input to Snaily Domain Authority. Free tier covers 30,000 domains a month.",
    secret: true,
    placeholder: "Paste the key from domcop.com/openpagerank",
  },
  {
    key: "CRAWLGRAPH_API_KEY",
    label: "CrawlGraph key",
    description:
      "Referring-domain counts from the Common Crawl webgraph — the only free source of real inbound-link data. Free tier is 15 lookups a month, so results are cached for 30 days and never fetched automatically.",
    secret: true,
    placeholder: "cg_live_… from crawlgraph.com",
  },
  {
    key: "GROK_API_KEY",
    label: "AI writing key",
    description:
      "Groq (gsk_…) or xAI (xai-…). The vendor is detected from the prefix, so either works.",
    secret: true,
    placeholder: "gsk_… or xai-…",
  },
  {
    key: "GROK_MODEL",
    label: "AI model",
    description:
      "Leave blank for the vendor default (llama-3.3-70b-versatile on Groq, grok-4 on xAI).",
    secret: false,
    placeholder: "llama-3.3-70b-versatile",
  },
  {
    key: "GOOGLE_CLIENT_ID",
    label: "Google OAuth client ID",
    description:
      "From the Google Cloud console. Must match the OAuth client whose redirect URIs include this site.",
    secret: false,
    placeholder: "…apps.googleusercontent.com",
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth client secret",
    description: "Rotate here if Google invalidates the current secret.",
    secret: true,
    placeholder: "Paste a new secret to replace the current one",
  },
];

/**
 * In-process cache.
 *
 * Consumers read secrets synchronously in many places (the keyword provider is
 * memoised, the OAuth client is built inline), so the store is hydrated into
 * `process.env` once at boot and refreshed whenever the owner saves. Reads stay
 * synchronous everywhere and no call site had to change.
 */

let loaded = false;

export async function loadSettings(): Promise<void> {
  try {
    const rows = await prisma.appSetting.findMany();
    for (const row of rows) {
      const value = decryptToken(row.value);
      // A blank stored value means "fall back to the environment".
      if (value.trim() !== "") process.env[row.key] = value;
    }
    loaded = true;
  } catch {
    // A settings table that is unreachable must not stop the app booting —
    // the environment values are still there.
  }
}

export function settingsLoaded(): boolean {
  return loaded;
}

/** Masked view for the UI. Never returns the secret. */
export type SettingView = SettingSpec & {
  /** "db" | "env" | "unset" — where the live value comes from. */
  source: "db" | "env" | "unset";
  preview: string;
  updatedAt: string | null;
};

function mask(value: string, secret: boolean): string {
  if (value === "") return "";
  if (!secret) return value;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export async function listSettings(): Promise<SettingView[]> {
  const rows = await prisma.appSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return SETTINGS.map((spec) => {
    const row = byKey.get(spec.key);
    const stored = row ? decryptToken(row.value) : "";
    const envValue = (process.env[spec.key] ?? "").trim();
    const live = stored.trim() !== "" ? stored : envValue;

    return {
      ...spec,
      source: stored.trim() !== "" ? "db" : envValue !== "" ? "env" : "unset",
      preview: mask(live, spec.secret),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

export async function saveSetting(
  key: SettingKey,
  value: string,
  updatedBy: string,
): Promise<void> {
  const encrypted = encryptToken(value);

  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: encrypted, updatedBy },
    update: { value: encrypted, updatedBy },
  });

  // Take effect immediately in this process; other instances pick it up on
  // their next boot.
  if (value.trim() !== "") process.env[key] = value;
}

export async function clearSetting(key: SettingKey): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key } });
  // Reverting to the environment needs a fresh process; the UI says so.
}

/**
 * The live value of one setting, in full.
 *
 * Only ever called from the owner-only reveal endpoint. Deliberately separate
 * from `listSettings`, which masks: revealing has to be an explicit act at a
 * single call site, not an option flag someone flips by accident.
 */
export async function revealSetting(key: SettingKey): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const stored = row ? decryptToken(row.value) : "";
  return stored.trim() !== "" ? stored : (process.env[key] ?? "").trim();
}
