import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/google/token-crypto";
export const SETTINGS = [
    {
        key: "SERPAPI_KEY",
        label: "SerpApi key",
        description: "Live Google SERP when monthly quota remains (auto-renews). Prefer this for SERP quality when available; DataForSEO covers exhaustion and authority/backlinks so load is shared.",
        secret: true,
        placeholder: "Paste a new key to replace the current one",
    },
    {
        key: "OPENPAGERANK_API_KEY",
        label: "OpenPageRank key",
        description: "Free link-graph rank from the Common Crawl web graph — the main input to Snaily Domain Authority. Free tier covers 30,000 domains a month.",
        secret: true,
        placeholder: "Paste the key from domcop.com/openpagerank",
    },
    {
        key: "CRAWLGRAPH_API_KEY",
        label: "CrawlGraph key",
        description: "Referring-domain counts from the Common Crawl webgraph — the only free source of real inbound-link data. Free tier is 15 lookups a month, so results are cached for 30 days and never fetched automatically.",
        secret: true,
        placeholder: "cg_live_… from crawlgraph.com",
    },
    {
        key: "DATAFORSEO_LOGIN",
        label: "DataForSEO login",
        description: "API login email from app.dataforseo.com. Used with the password for Basic auth. Never exposed to the browser.",
        secret: true,
        placeholder: "API login email",
    },
    {
        key: "DATAFORSEO_PASSWORD",
        label: "DataForSEO password",
        description: "API password from app.dataforseo.com. Powers provider-backed domain Rank and backlink summaries. Not Moz DA.",
        secret: true,
        placeholder: "API password",
    },
    {
        key: "GROK_API_KEY",
        label: "AI writing key",
        description: "Groq (gsk_…) or xAI (xai-…). The vendor is detected from the prefix, so either works.",
        secret: true,
        placeholder: "gsk_… or xai-…",
    },
    {
        key: "GROK_MODEL",
        label: "AI model",
        description: "Leave blank for the vendor default (llama-3.3-70b-versatile on Groq, grok-4 on xAI).",
        secret: false,
        placeholder: "llama-3.3-70b-versatile",
    },
    {
        key: "GOOGLE_CLIENT_ID",
        label: "Google OAuth client ID",
        description: "From the Google Cloud console. Must match the OAuth client whose redirect URIs include this site.",
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
let loadedAt = 0;
let inflight = null;
/**
 * How long a hydration is trusted before the store is read again.
 *
 * Serverless makes this matter: a key saved by one instance is invisible to
 * every other instance until that instance re-reads. Thirty seconds bounds how
 * long a rotated key can keep failing, without making a database round trip
 * part of every provider call.
 */
const SETTINGS_TTL_MS = 30_000;
/**
 * The environment as the process was started with.
 *
 * Captured before anything overwrites it so that clearing a stored setting can
 * put the original value back. Without this, deleting a key left the last
 * stored value sitting in `process.env` and "revert to environment" quietly
 * did nothing until the process died.
 */
const bootEnv = new Map();
let bootCaptured = false;
function captureBootEnv() {
    if (bootCaptured)
        return;
    for (const spec of SETTINGS)
        bootEnv.set(spec.key, process.env[spec.key]);
    bootCaptured = true;
}
export async function loadSettings() {
    captureBootEnv();
    try {
        const rows = await prisma.appSetting.findMany();
        const stored = new Map(rows.map((r) => [r.key, decryptToken(r.value)]));
        for (const spec of SETTINGS) {
            const value = stored.get(spec.key);
            if (value !== undefined && value.trim() !== "") {
                process.env[spec.key] = value;
                continue;
            }
            // No stored value, or a blank one: the environment is the answer again.
            const original = bootEnv.get(spec.key);
            if (original === undefined)
                delete process.env[spec.key];
            else
                process.env[spec.key] = original;
        }
        loaded = true;
        loadedAt = Date.now();
    }
    catch {
        // A settings table that is unreachable must not stop the app booting —
        // the environment values are still there.
    }
}
/**
 * Hydrate the store into the environment if it has not been done recently.
 *
 * Every provider reads its credentials synchronously out of `process.env`,
 * which is only correct if the store has been read into it first. That was
 * happening in exactly one module, so a key saved through the UI was stored,
 * encrypted, listed back correctly — and then ignored by DataForSEO, Google
 * and SerpApi, which is what made rotating a key require a redeploy.
 *
 * Idempotent and de-duplicated: concurrent callers share one read.
 */
export async function ensureSettings() {
    if (loaded && Date.now() - loadedAt < SETTINGS_TTL_MS)
        return;
    inflight ??= loadSettings().finally(() => {
        inflight = null;
    });
    await inflight;
}
/** Force the next `ensureSettings()` to re-read. Called after a save. */
export function invalidateSettings() {
    loadedAt = 0;
}
export function settingsLoaded() {
    return loaded;
}
function mask(value, secret) {
    if (value === "")
        return "";
    if (!secret)
        return value;
    if (value.length <= 8)
        return "••••••••";
    return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
export async function listSettings() {
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
export async function saveSetting(key, value, updatedBy) {
    const encrypted = encryptToken(value);
    await prisma.appSetting.upsert({
        where: { key },
        create: { key, value: encrypted, updatedBy },
        update: { value: encrypted, updatedBy },
    });
    // Immediate in this process; other instances pick it up within the TTL.
    if (value.trim() !== "")
        process.env[key] = value;
    invalidateSettings();
}
export async function clearSetting(key) {
    await prisma.appSetting.deleteMany({ where: { key } });
    // The next hydration restores whatever the environment had at boot.
    invalidateSettings();
    await loadSettings();
}
/**
 * The live value of one setting, in full.
 *
 * Only ever called from the owner-only reveal endpoint. Deliberately separate
 * from `listSettings`, which masks: revealing has to be an explicit act at a
 * single call site, not an option flag someone flips by accident.
 */
export async function revealSetting(key) {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const stored = row ? decryptToken(row.value) : "";
    return stored.trim() !== "" ? stored : (process.env[key] ?? "").trim();
}
