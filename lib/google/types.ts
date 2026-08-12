export const GOOGLE_SERVICES = ["search_console", "analytics"] as const;

export type GoogleService = (typeof GOOGLE_SERVICES)[number];

export function isGoogleService(v: string): v is GoogleService {
  return (GOOGLE_SERVICES as readonly string[]).includes(v);
}

/**
 * Every scope the app will ever need, requested once at sign-in.
 *
 * Asking per-service meant a second consent screen the first time someone
 * opened Analytics. One grant covers identity, Search Console and GA4 for
 * every project the user will ever add.
 */
export const LOGIN_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];


/** Days of history pulled per sync. Google reports lag ~2 days. */
export const SYNC_LOOKBACK_DAYS = 90;


export type PropertyOption = { id: string; name: string };
