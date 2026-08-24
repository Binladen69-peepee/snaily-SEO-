import { countryName } from "@/lib/countries";
import { prisma } from "@/lib/db";
import { SYNC_LOOKBACK_DAYS } from "@/lib/google/types";

/**
 * The measured half of the domain overview.
 *
 * Traffic over time, traffic by country, top pages by traffic and ranking
 * distribution over time all come from Search Console, which only reports on
 * properties you own. For anyone else's domain there is no free source for any
 * of it — a paid clickstream index is the only way — so instead of estimating
 * a plausible curve, this returns nothing and says why. A fabricated line on a
 * chart is indistinguishable from a real one, which makes it the most
 * misleading thing the app could draw.
 */

export const OVERVIEW_RANGES = ["30d", "90d", "1y", "all"] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export const RANGE_LABEL: Record<OverviewRange, string> = {
  "30d": "30D",
  "90d": "90D",
  "1y": "1Y",
  all: "All Time",
};

export function parseRange(value: string | undefined): OverviewRange {
  return OVERVIEW_RANGES.includes(value as OverviewRange)
    ? (value as OverviewRange)
    : "30d";
}

/**
 * The overview's tabs.
 *
 * These live here, beside the ranges, because both sides of the screen need
 * them: the server component reads the tab out of the URL to decide what to
 * fetch, and the client component renders the strip. They were previously
 * exported from the client component itself, which meant the page was calling
 * a client function from the server — a render-time crash on every visit to
 * the Explorer, not a type error, so nothing caught it before it shipped.
 */
export const OVERVIEW_TABS = [
  { id: "overview", label: "Overview" },
  { id: "pages", label: "Top Pages" },
  { id: "keywords", label: "Top Keywords" },
  // Not in the reference layout, but the SERP-rivals and referring-domains
  // tables predate it and are still the only view of either. A tab keeps them
  // without crowding the overview.
  { id: "competitors", label: "Competitors" },
] as const;

export type OverviewTab = (typeof OVERVIEW_TABS)[number]["id"];

export function parseTab(value: string | undefined): OverviewTab {
  return OVERVIEW_TABS.some((t) => t.id === value)
    ? (value as OverviewTab)
    : "overview";
}

function rangeDays(range: OverviewRange): number | null {
  if (range === "30d") return 30;
  if (range === "90d") return 90;
  if (range === "1y") return 365;
  return null;
}

/** Why the measured panels have nothing in them. */
export type OverviewGap =
  /** Somebody else's domain — Search Console will never report on it. */
  | "NOT_YOUR_SITE"
  /** Your project, but no Search Console property is linked to it. */
  | "NOT_CONNECTED"
  /** Linked, but no sync has run yet, or the range predates the first sync. */
  | "NOT_SYNCED";

export type TrafficPoint = {
  /** YYYY-MM-DD. */
  date: string;
  clicks: number;
  impressions: number;
};

export type CountryRow = {
  code: string;
  label: string;
  clicks: number;
  /** Share of clicks in the selected range, 0–100. */
  share: number;
  /** Distinct queries over the sync window; null when never synced. */
  keywords: number | null;
};

export type TopPageRow = {
  url: string;
  path: string;
  clicks: number;
  impressions: number;
  /** Average position across the range, or null when never ranked. */
  position: number | null;
};

/** Ranking spread on one day, in the bands the chart stacks. */
export type PositionPoint = {
  date: string;
  top3: number;
  four10: number;
  eleven20: number;
  beyond: number;
};

export type DomainOverview = {
  domain: string;
  range: OverviewRange;
  /** Null when the measured panels have real data behind them. */
  gap: OverviewGap | null;
  /** Search Console property backing this, for the UI to name. */
  propertyUrl: string | null;
  syncedAt: string | null;
  traffic: TrafficPoint[];
  countries: CountryRow[];
  /** Window the per-country keyword counts cover. */
  countryKeywordDays: number | null;
  topPages: TopPageRow[];
  positions: PositionPoint[];
  totalClicks: number;
  totalImpressions: number;
};

function empty(
  domain: string,
  range: OverviewRange,
  gap: OverviewGap,
  propertyUrl: string | null = null,
  syncedAt: Date | null = null,
): DomainOverview {
  return {
    domain,
    range,
    gap,
    propertyUrl,
    syncedAt: syncedAt?.toISOString() ?? null,
    traffic: [],
    countries: [],
    countryKeywordDays: null,
    topPages: [],
    positions: [],
    totalClicks: 0,
    totalImpressions: 0,
  };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sameDomain(a: string, b: string): boolean {
  const strip = (v: string) =>
    v
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "")
      .trim()
      .toLowerCase();
  return strip(a) !== "" && strip(a) === strip(b);
}

/**
 * Search Console's measured view of a domain, when we have one.
 *
 * `projectId` is not enough on its own: the overview is asked for whatever
 * domain is in the search box, which is usually *not* the active project. The
 * domain has to match a project the user owns before any of its data is shown,
 * otherwise searching a competitor would render your own numbers under their
 * name.
 */
export async function getDomainOverview(
  domain: string,
  userId: string | null,
  range: OverviewRange,
): Promise<DomainOverview> {
  if (userId === null) return empty(domain, range, "NOT_YOUR_SITE");

  const projects = await prisma.project.findMany({
    where: { userId },
    select: { id: true, url: true, gscSiteUrl: true, gscSyncedAt: true },
  });

  const match = projects.find((p) => sameDomain(p.url, domain));
  if (!match) return empty(domain, range, "NOT_YOUR_SITE");
  if (match.gscSiteUrl === null) return empty(domain, range, "NOT_CONNECTED");

  const days = rangeDays(range);
  const since = (() => {
    if (days === null) return undefined;
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  })();

  const where = { projectId: match.id, ...(since ? { date: { gte: since } } : {}) };

  const [pageRows, countryRows, countryKeywords, queryRows] = await Promise.all([
    prisma.gscPageMetric.findMany({
      where,
      select: {
        date: true,
        page: true,
        clicks: true,
        impressions: true,
        position: true,
      },
    }),
    prisma.gscCountryMetric.findMany({
      where,
      select: { country: true, clicks: true },
    }),
    prisma.gscCountryKeyword.findMany({
      where: { projectId: match.id },
      select: { country: true, keywords: true, windowDays: true },
    }),
    prisma.gscQueryMetric.findMany({
      where,
      select: { date: true, position: true },
    }),
  ]);

  if (pageRows.length === 0 && countryRows.length === 0 && queryRows.length === 0) {
    return empty(domain, range, "NOT_SYNCED", match.gscSiteUrl, match.gscSyncedAt);
  }

  /* ---------- Traffic over time ---------- */
  const byDay = new Map<string, { clicks: number; impressions: number }>();
  for (const r of pageRows) {
    const key = isoDay(r.date);
    const acc = byDay.get(key) ?? { clicks: 0, impressions: 0 };
    acc.clicks += r.clicks;
    acc.impressions += r.impressions;
    byDay.set(key, acc);
  }
  const traffic: TrafficPoint[] = [...byDay.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalClicks = traffic.reduce((s, p) => s + p.clicks, 0);
  const totalImpressions = traffic.reduce((s, p) => s + p.impressions, 0);

  /* ---------- Traffic by country ---------- */
  const clicksByCountry = new Map<string, number>();
  for (const r of countryRows) {
    clicksByCountry.set(r.country, (clicksByCountry.get(r.country) ?? 0) + r.clicks);
  }
  const countryTotal = [...clicksByCountry.values()].reduce((s, v) => s + v, 0);
  const keywordsByCountry = new Map(
    countryKeywords.map((r) => [r.country, r.keywords]),
  );

  const countries: CountryRow[] = [...clicksByCountry.entries()]
    .map(([code, clicks]) => ({
      code,
      label: countryName(code),
      clicks,
      share: countryTotal === 0 ? 0 : (clicks / countryTotal) * 100,
      keywords: keywordsByCountry.get(code) ?? null,
    }))
    .sort((a, b) => b.clicks - a.clicks);

  /* ---------- Top pages ---------- */
  const byPage = new Map<
    string,
    { clicks: number; impressions: number; posSum: number; posDays: number }
  >();
  for (const r of pageRows) {
    const acc = byPage.get(r.page) ?? {
      clicks: 0,
      impressions: 0,
      posSum: 0,
      posDays: 0,
    };
    acc.clicks += r.clicks;
    acc.impressions += r.impressions;
    // Position 0 means Search Console reported no ranking that day; averaging
    // it in would drag every page towards the first slot.
    if (r.position > 0) {
      acc.posSum += r.position;
      acc.posDays += 1;
    }
    byPage.set(r.page, acc);
  }

  const topPages: TopPageRow[] = [...byPage.entries()]
    .map(([url, v]) => ({
      url,
      path: (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })(),
      clicks: v.clicks,
      impressions: v.impressions,
      position: v.posDays === 0 ? null : v.posSum / v.posDays,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 25);

  /* ---------- Keywords by position, over time ---------- */
  const bands = new Map<string, PositionPoint>();
  for (const r of queryRows) {
    if (r.position <= 0) continue;
    const key = isoDay(r.date);
    const point = bands.get(key) ?? {
      date: key,
      top3: 0,
      four10: 0,
      eleven20: 0,
      beyond: 0,
    };
    if (r.position <= 3) point.top3 += 1;
    else if (r.position <= 10) point.four10 += 1;
    else if (r.position <= 20) point.eleven20 += 1;
    else point.beyond += 1;
    bands.set(key, point);
  }
  const positions = [...bands.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return {
    domain,
    range,
    gap: null,
    propertyUrl: match.gscSiteUrl,
    syncedAt: match.gscSyncedAt?.toISOString() ?? null,
    traffic,
    countries,
    countryKeywordDays: countryKeywords[0]?.windowDays ?? SYNC_LOOKBACK_DAYS,
    topPages,
    positions,
    totalClicks,
    totalImpressions,
  };
}
