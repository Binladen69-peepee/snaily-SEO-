/**
 * Linking a project to the Google property that obviously belongs to it.
 *
 * The picker worked and the Google account was connected the whole time; the
 * owner just never got to it. The prompt saying "no property is selected"
 * linked to the projects list rather than to the project, so following it
 * arrived somewhere with no picker on it, and Search Console never synced.
 *
 * For a one-site install, choosing is not a decision anyone wants to make. If
 * the account can see exactly one Search Console property, or one whose domain
 * is the project's own domain, that is the answer — so it is saved without
 * asking. The same for Analytics.
 *
 * Two rules keep this from ever guessing:
 *
 *   - A value the owner already set is never replaced.
 *   - Ambiguity is left alone. Several properties and none of them matching
 *     the project's domain means the picker is the right place to decide, and
 *     this does nothing.
 */

import { getGoogleClient } from "@/lib/google/account";
import {
  listAnalyticsProperties,
  listSearchConsoleSites,
} from "@/lib/google/client";
import { prisma } from "@/lib/db";

export type AutoLinkResult = {
  gscSiteUrl: string | null;
  gscSiteName: string | null;
  ga4PropertyId: string | null;
  ga4PropertyName: string | null;
  /** What changed, for the log. Empty when nothing did. */
  linked: string[];
};

type Option = { id: string; name: string };

/** Host of a project URL, without www, for comparing against property names. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url.toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
  }
}

/**
 * The option that belongs to this domain.
 *
 * Search Console identifies a domain property as `sc-domain:example.com` and a
 * URL-prefix one as `https://example.com/`, so the host is looked for in the
 * id and in the human name. When only one option exists at all, it is taken —
 * an account with a single property and a project on a single domain is not an
 * ambiguous case.
 */
export function pickForDomain(options: Option[], host: string): Option | null {
  if (options.length === 0) return null;

  const matches = options.filter(
    (o) =>
      o.id.toLowerCase().includes(host) || o.name.toLowerCase().includes(host),
  );
  if (matches.length === 1) return matches[0] ?? null;

  // No name matched, but there is only one thing it could be.
  if (matches.length === 0 && options.length === 1) return options[0] ?? null;

  // Several candidates: a person should choose.
  return null;
}

/**
 * Link a project to its Google properties when the answer is unambiguous.
 *
 * Safe to call on every page load: it returns immediately once both are set,
 * and it never contacts Google when there is nothing left to fill in.
 */
export async function autoLinkGoogleProperties(
  userId: string,
  projectId: string,
  origin: string,
): Promise<AutoLinkResult | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      url: true,
      gscSiteUrl: true,
      gscSiteName: true,
      ga4PropertyId: true,
      ga4PropertyName: true,
    },
  });
  if (project === null) return null;

  const needsGsc = (project.gscSiteUrl ?? "") === "";
  const needsGa4 = (project.ga4PropertyId ?? "") === "";
  if (!needsGsc && !needsGa4) {
    return {
      gscSiteUrl: project.gscSiteUrl,
      gscSiteName: project.gscSiteName,
      ga4PropertyId: project.ga4PropertyId,
      ga4PropertyName: project.ga4PropertyName,
      linked: [],
    };
  }

  let client;
  try {
    client = await getGoogleClient(userId, origin);
  } catch {
    // No Google, or a token that will not refresh. The screens already say so.
    return null;
  }
  if (client === null) return null;

  const host = hostOf(project.url);
  const linked: string[] = [];

  const data: {
    gscSiteUrl?: string;
    gscSiteName?: string;
    ga4PropertyId?: string;
    ga4PropertyName?: string;
  } = {};

  if (needsGsc) {
    const sites = await listSearchConsoleSites(client).catch(() => [] as Option[]);
    const pick = pickForDomain(sites, host);
    if (pick !== null) {
      data.gscSiteUrl = pick.id;
      data.gscSiteName = pick.name;
      linked.push("Search Console");
    }
  }

  if (needsGa4) {
    const props = await listAnalyticsProperties(client).catch(() => [] as Option[]);
    const pick = pickForDomain(props, host);
    if (pick !== null) {
      data.ga4PropertyId = pick.id;
      data.ga4PropertyName = pick.name;
      linked.push("Analytics");
    }
  }

  if (linked.length > 0) {
    await prisma.project.update({ where: { id: projectId }, data });
    // Which project and which service; never a token or an id worth hiding.
    console.info(
      `[google] auto-linked ${linked.join(" and ")} for project ${projectId}`,
    );
  }

  return {
    gscSiteUrl: data.gscSiteUrl ?? project.gscSiteUrl,
    gscSiteName: data.gscSiteName ?? project.gscSiteName,
    ga4PropertyId: data.ga4PropertyId ?? project.ga4PropertyId,
    ga4PropertyName: data.ga4PropertyName ?? project.ga4PropertyName,
    linked,
  };
}
