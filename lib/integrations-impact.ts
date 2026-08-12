import type { HealthCheck, HealthLevel } from "@/lib/settings-health";

/**
 * What depends on what.
 *
 * The point of this map is that the owner should never have to reason about
 * consequences during an outage. Each integration lists the features that
 * actually import it, so "the SerpApi key expired" reads as "rank tracking,
 * competitor analysis and GEO Lab signals stop" instead of a shrug.
 *
 * Every entry below was traced from the imports in the codebase, not guessed:
 *   SERPAPI_KEY     lib/keywords/provider, lib/competitors, lib/rank-tracker,
 *                   lib/optimizer, lib/geo/signals
 *   GROK_API_KEY    app/api/articles/[id]/generate, lib/geo/generate,
 *                   lib/geo/draft
 *   GOOGLE_CLIENT_* lib/google/client, lib/google/account
 *   GOOGLE_TOKENS   lib/google/sync, lib/rank-tracker (GscQueryMetric),
 *                   lib/geo/signals
 * Keep it that way: a stale map is worse than none, because it is believed.
 */

export type ImpactLevel =
  /** The feature cannot run at all. */
  | "stops"
  /** The feature still runs, on worse data. */
  | "degrades";

export type Dependent = {
  feature: string;
  href: string;
  level: ImpactLevel;
  /** What the user actually sees when this breaks. */
  consequence: string;
};

export const DEPENDENTS: Record<string, Dependent[]> = {
  SERPAPI_KEY: [
    {
      feature: "Keyword Research",
      href: "/keywords",
      level: "degrades",
      consequence:
        "Falls back to generated sample data instead of live results. Badged on Keyword Research and Bulk Check — but not on Quick Difficulty, Brainstorm, the keyword detail page or Backlink Checker, which show generated numbers with no warning.",
    },
    {
      feature: "Quick Difficulty",
      href: "/keywords/difficulty",
      level: "degrades",
      consequence: "Difficulty is computed from the live SERP, so with no SERP it scores generated results.",
    },
    {
      feature: "Competitive Analysis",
      href: "/competitors",
      level: "stops",
      consequence: "Live competitor lookups return nothing; only previously cached results remain.",
    },
    {
      feature: "Rank Tracker (live checks)",
      href: "/tracking",
      level: "degrades",
      consequence:
        "Live position checks stop with \"Live rank checks need SERPAPI_KEY\". Positions already recorded, and anything sourced from Search Console, still show.",
    },
    {
      feature: "Content Optimizer",
      href: "/content-assistant",
      level: "degrades",
      consequence: "Target terms are derived from the ranking pages, so they come from generated results instead.",
    },
    {
      feature: "GEO Lab — Map the Moments",
      href: "/geo-lab",
      level: "degrades",
      consequence:
        "Loses People Also Ask and related searches. Mapping still runs on Search Console queries alone, and drafts get no FAQ because there are no observed questions.",
    },
  ],

  GROK_API_KEY: [
    {
      feature: "Content Assistant — article generation",
      href: "/content-assistant",
      level: "stops",
      consequence: "Every AI writing action fails. Existing articles remain readable and editable.",
    },
    {
      feature: "GEO Lab — Map the Moments",
      href: "/geo-lab",
      level: "stops",
      consequence: "Moments cannot be generated. Ideas already mapped stay in place.",
    },
    {
      feature: "GEO Lab — drafting",
      href: "/geo-lab",
      level: "stops",
      consequence: "Drafting fails at the first stage. Drafts already written stay editable and exportable.",
    },
  ],

  GOOGLE_CLIENT_ID: [
    {
      feature: "Sign in with Google",
      href: "/login",
      level: "stops",
      consequence: "Nobody can sign in with Google. Email and password sign-in is unaffected.",
    },
    {
      feature: "Search Console & Analytics sync",
      href: "/projects",
      level: "stops",
      consequence:
        "Access tokens are refreshed with these credentials, so syncing stops within the hour even for accounts already connected.",
    },
    {
      feature: "Property selection",
      href: "/projects",
      level: "stops",
      consequence: "New projects cannot be linked to a Search Console or Analytics property.",
    },
  ],

  GOOGLE_TOKENS: [
    {
      feature: "Search Console data",
      href: "/tracking",
      level: "stops",
      consequence: "No new query, impression or click data arrives. Previously synced rows still display.",
    },
    {
      feature: "Analytics data",
      href: "/projects",
      level: "stops",
      consequence: "GA4 page metrics stop updating.",
    },
    {
      feature: "Rank Tracker (Search Console view)",
      href: "/tracking",
      level: "degrades",
      consequence: "Falls back to SerpApi positions only; the Search Console comparison goes stale.",
    },
    {
      feature: "GEO Lab — unmet-intent signal",
      href: "/geo-lab",
      level: "degrades",
      consequence:
        "Loses the strongest signal it has — real queries with impressions but few clicks. Mapping continues on SERP data alone.",
    },
  ],

  DATABASE_URL: [
    {
      feature: "Everything",
      href: "/dashboard",
      level: "stops",
      consequence:
        "Sign-in, projects, saved keywords, articles, GEO Lab and all history live here. There is no fallback and no cache to fall back to.",
    },
  ],

  AUTH_SECRET: [
    {
      feature: "Sign-in and sessions",
      href: "/login",
      level: "stops",
      consequence: "Sessions are signed with it. Changing it signs every user out immediately.",
    },
    {
      feature: "Stored Google tokens",
      href: "/projects",
      level: "stops",
      consequence:
        "OAuth tokens are encrypted with a key derived from it. Change it and they cannot be decrypted — every user must reconnect Google.",
    },
  ],
};

/** Levels that mean something downstream is actually affected right now. */
const BREAKING: HealthLevel[] = ["failing", "warning"];

export type AffectedFeature = Dependent & {
  /** Which integration is causing it. */
  causeId: string;
  causeLabel: string;
  causeLevel: HealthLevel;
};

/**
 * The features affected by whatever is currently unhealthy.
 *
 * Ordered worst-first, and deduplicated by feature so one broken key does not
 * list the same page three times.
 */
export function affectedNow(checks: HealthCheck[]): AffectedFeature[] {
  const out: AffectedFeature[] = [];

  for (const check of checks) {
    if (!BREAKING.includes(check.level)) continue;

    for (const dep of DEPENDENTS[check.id] ?? []) {
      out.push({
        ...dep,
        causeId: check.id,
        causeLabel: check.label,
        causeLevel: check.level,
      });
    }
  }

  const rank = (a: AffectedFeature) =>
    (a.causeLevel === "failing" ? 0 : 2) + (a.level === "stops" ? 0 : 1);

  const seen = new Set<string>();
  return out
    .sort((a, b) => rank(a) - rank(b))
    .filter((a) => {
      if (seen.has(a.feature)) return false;
      seen.add(a.feature);
      return true;
    });
}
