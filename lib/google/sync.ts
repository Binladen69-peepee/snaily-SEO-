import type { OAuth2Client } from "google-auth-library";

import { prisma } from "@/lib/db";
import { getGoogleClient } from "@/lib/google/account";
import { analyticsData, searchConsole } from "@/lib/google/client";
import { SYNC_LOOKBACK_DAYS } from "@/lib/google/types";

/**
 * Imports Google performance data.
 *
 * Rows are written with deleteMany + createMany per date window rather than a
 * per-row upsert loop: a 90-day pull is tens of thousands of rows, and one
 * round-trip each would blow past any serverless request budget.
 */

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function window(days: number) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2); // Google reporting lag
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: isoDate(start), end: isoDate(end) };
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** GA4 returns YYYYMMDD. */
function fromGaDate(v: string): string {
  return v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
}

async function syncSearchConsole(
  auth: OAuth2Client,
  projectId: string,
  siteUrl: string,
): Promise<number> {
  const sc = searchConsole(auth);
  const { start, end } = window(SYNC_LOOKBACK_DAYS);

  const [pages, queries] = await Promise.all([
    sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: start,
        endDate: end,
        dimensions: ["date", "page"],
        rowLimit: 25_000,
      },
    }),
    sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: start,
        endDate: end,
        dimensions: ["date", "query"],
        rowLimit: 25_000,
      },
    }),
  ]);

  const pageRows = (pages.data.rows ?? []).map((r) => ({
    projectId,
    date: toDate(r.keys?.[0] ?? start),
    page: r.keys?.[1] ?? "",
    clicks: Math.round(r.clicks ?? 0),
    impressions: Math.round(r.impressions ?? 0),
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));

  const queryRows = (queries.data.rows ?? []).map((r) => ({
    projectId,
    date: toDate(r.keys?.[0] ?? start),
    query: r.keys?.[1] ?? "",
    clicks: Math.round(r.clicks ?? 0),
    impressions: Math.round(r.impressions ?? 0),
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));

  const from = toDate(start);
  await prisma.$transaction([
    prisma.gscPageMetric.deleteMany({ where: { projectId, date: { gte: from } } }),
    prisma.gscQueryMetric.deleteMany({ where: { projectId, date: { gte: from } } }),
  ]);

  // Chunked so a single statement never gets unreasonably large.
  for (let i = 0; i < pageRows.length; i += 1000) {
    await prisma.gscPageMetric.createMany({
      data: pageRows.slice(i, i + 1000),
      skipDuplicates: true,
    });
  }
  for (let i = 0; i < queryRows.length; i += 1000) {
    await prisma.gscQueryMetric.createMany({
      data: queryRows.slice(i, i + 1000),
      skipDuplicates: true,
    });
  }

  return pageRows.length + queryRows.length;
}

async function syncAnalytics(
  auth: OAuth2Client,
  projectId: string,
  propertyId: string,
): Promise<number> {
  const data = analyticsData(auth);
  const { start, end } = window(SYNC_LOOKBACK_DAYS);

  const property = propertyId.startsWith("properties/")
    ? propertyId
    : `properties/${propertyId}`;

  const res = await data.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: "date" }, { name: "landingPagePlusQueryString" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "screenPageViews" },
        { name: "engagementRate" },
        { name: "userEngagementDuration" },
      ],
      limit: "100000",
    },
  });

  const rows = (res.data.rows ?? []).map((r) => {
    const m = r.metricValues ?? [];
    return {
      projectId,
      date: toDate(fromGaDate(r.dimensionValues?.[0]?.value ?? "")),
      pagePath: r.dimensionValues?.[1]?.value ?? "/",
      sessions: Math.round(Number(m[0]?.value ?? 0)),
      users: Math.round(Number(m[1]?.value ?? 0)),
      pageViews: Math.round(Number(m[2]?.value ?? 0)),
      engagementRate: Number(m[3]?.value ?? 0),
      avgEngagementTime: Number(m[4]?.value ?? 0),
    };
  });

  await prisma.ga4PageMetric.deleteMany({
    where: { projectId, date: { gte: toDate(start) } },
  });

  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.ga4PageMetric.createMany({
      data: rows.slice(i, i + 1000),
      skipDuplicates: true,
    });
  }

  return rows.length;
}

/**
 * Syncs whichever Google properties a project has linked.
 *
 * Project-scoped rather than connection-scoped: one signed-in Google account
 * serves every project, so the only question here is which property this
 * project points at. Services are independent — Search Console failing does
 * not stop GA4 importing.
 */
export async function runSync(
  userId: string,
  projectId: string,
  origin: string,
): Promise<{ rowsImported: number; errors: string[] }> {
  const project = await prisma.project.findFirstOrThrow({
    where: { id: projectId, userId },
    select: { gscSiteUrl: true, ga4PropertyId: true },
  });

  if (project.gscSiteUrl === null && project.ga4PropertyId === null) {
    throw new Error("Link a Search Console or Analytics property first.");
  }

  const auth = await getGoogleClient(userId, origin);
  if (auth === null) {
    throw new Error("Sign in with Google to sync.");
  }

  let rowsImported = 0;
  const errors: string[] = [];

  if (project.gscSiteUrl !== null) {
    try {
      rowsImported += await syncSearchConsole(auth, projectId, project.gscSiteUrl);
      await prisma.project.update({
        where: { id: projectId },
        data: { gscSyncedAt: new Date() },
      });
    } catch (err) {
      errors.push(
        `Search Console: ${err instanceof Error ? err.message : "sync failed"}`,
      );
    }
  }

  if (project.ga4PropertyId !== null) {
    try {
      rowsImported += await syncAnalytics(auth, projectId, project.ga4PropertyId);
      await prisma.project.update({
        where: { id: projectId },
        data: { ga4SyncedAt: new Date() },
      });
    } catch (err) {
      errors.push(
        `Analytics: ${err instanceof Error ? err.message : "sync failed"}`,
      );
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { googleSyncError: errors.length > 0 ? errors.join(" · ") : null },
  });

  if (rowsImported === 0 && errors.length > 0) throw new Error(errors.join(" · "));

  return { rowsImported, errors };
}
