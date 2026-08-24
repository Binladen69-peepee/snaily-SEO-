import { prisma } from "@/lib/db";

/** Remind Me Later cookie. Value is `{projectId}:{expiryMs}`. */
export const SNOOZE_COOKIE = "snaily-setup-snooze";
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

/**
 * One setup snapshot for the active project.
 *
 * Conceptual WordPress states (mapped onto `wordpress.health`):
 *   not_configured  — no credentials stored
 *   connection_lost — credentials stored, last health check failed
 *   connected       — last health check succeeded
 *
 * Project-level progress also includes website + Google. SETUP_IN_PROGRESS and
 * SETUP_COMPLETE are derived: remaining > 0 vs remaining === 0.
 *
 * Every surface (header, floating card, dashboard, Drafter, onboarding) reads
 * this shape so WordPress health is not re-derived in five different ways.
 * Live pings of the plugin are *not* done here — that would hang the app
 * shell whenever WordPress is down. Health is the last stored result;
 * `/api/wordpress/verify` refreshes it.
 */

export type StepHealth =
  | "connected"
  | "not_configured"
  | "connection_lost";

export type SetupStepId = "website" | "google" | "wordpress";

export type SetupStep = {
  id: SetupStepId;
  label: string;
  done: boolean;
  health: StepHealth;
  detail: string;
};

export type WordpressHealth = StepHealth;

/** Stored health only — never a live ping. A row is not "connected". */
export function wordpressHealthFromRow(
  wp: { lastError: string | null } | null | undefined,
): WordpressHealth {
  if (!wp) return "not_configured";
  return wp.lastError !== null && wp.lastError !== ""
    ? "connection_lost"
    : "connected";
}

export type SetupSnapshot = {
  projectId: string;
  projectName: string;
  projectUrl: string;
  onboarded: boolean;
  reminderMuted: boolean;
  steps: SetupStep[];
  completed: number;
  total: number;
  percent: number;
  remaining: number;
  wordpress: {
    health: WordpressHealth;
    siteUrl: string;
    siteName: string;
    lastError: string | null;
    lastSyncedAt: string | null;
  };
  /** True when the owner still needs to act on WordPress (skip or reconnect). */
  needsWordpressAttention: boolean;
};

export async function getSetupSnapshot(
  projectId: string,
): Promise<SetupSnapshot | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      url: true,
      onboardedAt: true,
      wpReminderMuted: true,
      gscSiteUrl: true,
      ga4PropertyId: true,
      wordpress: {
        select: {
          siteUrl: true,
          siteName: true,
          lastError: true,
          lastSyncedAt: true,
        },
      },
    },
  });

  if (!project) return null;

  const googleDone =
    (project.gscSiteUrl !== null && project.gscSiteUrl !== "") ||
    (project.ga4PropertyId !== null && project.ga4PropertyId !== "");

  const wp = project.wordpress;
  const wpHealth = wordpressHealthFromRow(wp);

  const steps: SetupStep[] = [
    {
      id: "website",
      label: "Website",
      done: true,
      health: "connected",
      detail: project.url.replace(/^https?:\/\//, ""),
    },
    {
      id: "google",
      label: "Google",
      done: googleDone,
      health: googleDone ? "connected" : "not_configured",
      detail: googleDone
        ? "Search Console or Analytics linked"
        : "Search Console and Analytics not linked",
    },
    {
      id: "wordpress",
      label: "WordPress",
      done: wpHealth === "connected",
      health: wpHealth,
      detail:
        wpHealth === "connected"
          ? wp?.siteName || wp?.siteUrl || "Connected"
          : wpHealth === "connection_lost"
            ? "Connector is no longer active"
            : "Not connected",
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;

  return {
    projectId: project.id,
    projectName: project.name,
    projectUrl: project.url,
    onboarded: project.onboardedAt !== null,
    reminderMuted: project.wpReminderMuted,
    steps,
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    remaining: total - completed,
    wordpress: {
      health: wpHealth,
      siteUrl: wp?.siteUrl ?? "",
      siteName: wp?.siteName ?? "",
      lastError: wp?.lastError ?? null,
      lastSyncedAt: wp?.lastSyncedAt?.toISOString() ?? null,
    },
    needsWordpressAttention: wpHealth !== "connected",
  };
}
