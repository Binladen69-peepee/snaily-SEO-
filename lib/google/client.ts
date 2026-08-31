import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

import type { PropertyOption } from "@/lib/google/types";

/**
 * Authenticated client for a stored connection. Refreshes the access token when
 * it is close to expiry and writes the new tokens back.
 */
export async function listSearchConsoleSites(
  auth: OAuth2Client,
): Promise<PropertyOption[]> {
  const res = await google.searchconsole({ version: "v1", auth }).sites.list();

  return (res.data.siteEntry ?? [])
    .filter((s) => s.siteUrl)
    .map((s) => {
      const id = s.siteUrl!;
      const name = id.startsWith("sc-domain:")
        ? `Domain · ${id.slice("sc-domain:".length)}`
        : id;
      return { id, name };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAnalyticsProperties(
  auth: OAuth2Client,
): Promise<PropertyOption[]> {
  const res = await google
    .analyticsadmin({ version: "v1beta", auth })
    .accountSummaries.list({ pageSize: 200 });

  const out: PropertyOption[] = [];
  for (const account of res.data.accountSummaries ?? []) {
    for (const prop of account.propertySummaries ?? []) {
      if (!prop.property) continue;
      out.push({
        id: prop.property,
        name: `${prop.displayName ?? prop.property} — ${account.displayName ?? "account"}`,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function searchConsole(auth: OAuth2Client) {
  return google.searchconsole({ version: "v1", auth });
}

export function analyticsData(auth: OAuth2Client) {
  return google.analyticsdata({ version: "v1beta", auth });
}
