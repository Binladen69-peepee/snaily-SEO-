/**
 * Who provides each integration, and where the owner goes to manage it.
 *
 * Favicons are loaded from the provider's own domain rather than bundled, so
 * they stay correct when a vendor rebrands. Every card falls back to a
 * lettermark if the request fails, so a blocked image never leaves a hole.
 */

export type ServiceInfo = {
  /** Matches a HealthCheck id. */
  id: string;
  /** The company behind it, not the field name. */
  vendor: string;
  /** Where the favicon comes from. */
  favicon: string;
  /** Where the owner manages the account. */
  console: string;
  consoleLabel: string;
};

export const SERVICES: Record<string, ServiceInfo> = {
  SERPAPI_KEY: {
    id: "SERPAPI_KEY",
    vendor: "SerpApi",
    favicon: "https://serpapi.com/favicon.ico",
    console: "https://serpapi.com/manage-api-key",
    consoleLabel: "SerpApi dashboard",
  },
  GROK_API_KEY: {
    id: "GROK_API_KEY",
    vendor: "Groq",
    favicon: "https://groq.com/favicon.ico",
    console: "https://console.groq.com/keys",
    consoleLabel: "Groq console",
  },
  GROK_MODEL: {
    id: "GROK_MODEL",
    vendor: "Groq",
    favicon: "https://groq.com/favicon.ico",
    console: "https://console.groq.com/docs/models",
    consoleLabel: "Model list",
  },
  GOOGLE_CLIENT_ID: {
    id: "GOOGLE_CLIENT_ID",
    vendor: "Google Cloud",
    favicon: "https://www.google.com/favicon.ico",
    console: "https://console.cloud.google.com/apis/credentials",
    consoleLabel: "Google Cloud credentials",
  },
  GOOGLE_CLIENT_SECRET: {
    id: "GOOGLE_CLIENT_SECRET",
    vendor: "Google Cloud",
    favicon: "https://www.google.com/favicon.ico",
    console: "https://console.cloud.google.com/apis/credentials",
    consoleLabel: "Google Cloud credentials",
  },
  GOOGLE_TOKENS: {
    id: "GOOGLE_TOKENS",
    vendor: "Google",
    favicon: "https://www.google.com/favicon.ico",
    console: "https://myaccount.google.com/permissions",
    consoleLabel: "Google account access",
  },
  DATABASE_URL: {
    id: "DATABASE_URL",
    vendor: "Supabase",
    favicon: "https://supabase.com/favicon.ico",
    console: "https://supabase.com/dashboard",
    consoleLabel: "Supabase dashboard",
  },
  AUTH_SECRET: {
    id: "AUTH_SECRET",
    vendor: "This deployment",
    favicon: "https://vercel.com/favicon.ico",
    console: "https://vercel.com/dashboard",
    consoleLabel: "Vercel project settings",
  },
  DATAFORSEO_LOGIN: {
    id: "DATAFORSEO_LOGIN",
    vendor: "DataForSEO",
    favicon: "https://dataforseo.com/favicon.ico",
    console: "https://app.dataforseo.com/api-access",
    consoleLabel: "DataForSEO API access",
  },
  DATAFORSEO_PASSWORD: {
    id: "DATAFORSEO_PASSWORD",
    vendor: "DataForSEO",
    favicon: "https://dataforseo.com/favicon.ico",
    console: "https://app.dataforseo.com/api-access",
    consoleLabel: "DataForSEO API access",
  },
};

/** For the lettermark fallback when a favicon will not load. */
export function initialsFor(vendor: string): string {
  return vendor
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
