/**
 * Which settings belong to which provider.
 *
 * The Integrations screen rendered one card per setting *key*, so DataForSEO
 * arrived as two unrelated cards — a login and a password — and Google as
 * another two. A credential pair is one thing to the person holding it, and
 * splitting it means saving half of it and wondering why nothing connected.
 *
 * This is the grouping only. The values still live in the encrypted settings
 * store and are still resolved store-then-environment; nothing here duplicates
 * that.
 */

import type { SettingKey } from "@/lib/settings";

export type ProviderId =
  | "dataforseo"
  | "google"
  | "serpapi"
  | "grok"
  | "openpagerank"
  | "crawlgraph";

export type ProviderSpec = {
  id: ProviderId;
  name: string;
  /** One line on what the provider does for this product. */
  purpose: string;
  /** Setting keys this provider owns, in the order they should be shown. */
  keys: SettingKey[];
  /**
   * Whether saving can be checked against the provider before it is committed.
   * Only providers with a cheap, side-effect-free auth probe qualify.
   */
  verifiable: boolean;
  /** Where the credentials come from, shown as a hint under the fields. */
  console: string;
};

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "dataforseo",
    name: "DataForSEO",
    purpose:
      "Primary source for live SERPs, keyword autocomplete and domain authority.",
    keys: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    verifiable: true,
    console: "app.dataforseo.com/api-access",
  },
  {
    id: "google",
    name: "Google",
    purpose:
      "Sign-in, Search Console and Analytics. The OAuth client this app authenticates as.",
    keys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    /*
     * Verifiable, but only as configuration. A client id and secret can be
     * checked against Google's token endpoint without any user being involved;
     * what must never happen is silently exchanging a real user's credentials
     * to prove a key works.
     */
    verifiable: true,
    console: "console.cloud.google.com/apis/credentials",
  },
  {
    id: "serpapi",
    name: "SerpApi",
    purpose: "Fallback SERP provider, used only when DataForSEO is unavailable.",
    keys: ["SERPAPI_KEY"],
    verifiable: true,
    console: "serpapi.com/manage-api-key",
  },
  {
    id: "grok",
    name: "AI writing",
    purpose: "The model Drafter writes with.",
    keys: ["GROK_API_KEY", "GROK_MODEL"],
    verifiable: false,
    console: "console.groq.com/keys",
  },
  {
    id: "openpagerank",
    name: "OpenPageRank",
    purpose:
      "Free link-graph rank, the main input to Snaily Domain Authority when DataForSEO has no answer.",
    keys: ["OPENPAGERANK_API_KEY"],
    verifiable: false,
    console: "domcop.com/openpagerank",
  },
  {
    id: "crawlgraph",
    name: "CrawlGraph",
    purpose: "Referring-domain counts from the Common Crawl web graph.",
    keys: ["CRAWLGRAPH_API_KEY"],
    verifiable: false,
    console: "crawlgraph.com",
  },
];

/** The provider a setting key belongs to, or null for an ungrouped key. */
export function providerForKey(key: SettingKey): ProviderSpec | null {
  return PROVIDERS.find((p) => p.keys.includes(key)) ?? null;
}

export function providerById(id: string): ProviderSpec | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * The status a provider card shows.
 *
 * Deliberately not the raw provider error: "You are not authorized to access
 * this resource. See your login details here: …" is DataForSEO talking to a
 * developer, not this product talking to its owner.
 */
export type ProviderStatus =
  | "not_configured"
  | "connected"
  | "auth_failed"
  | "unavailable"
  | "verifying";

export const STATUS_LABEL: Record<ProviderStatus, string> = {
  not_configured: "Not configured",
  connected: "Connected",
  auth_failed: "Authentication failed",
  unavailable: "Unavailable",
  verifying: "Verifying…",
};
