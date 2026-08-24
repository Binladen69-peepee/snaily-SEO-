/**
 * One reading of the connector's state, shared by every screen that shows it.
 *
 * Project Settings and Integrations both answer the same question — is the
 * plugin installed, is it current, is it answering — and the way that goes
 * wrong is that they answer it slightly differently and disagree in front of
 * the user. So the four states are derived here, once, from the verify
 * endpoint's own reason code, and both screens render whatever this returns.
 */

/** Where the installable archive comes from. One route, so one version. */
export const CONNECTOR_DOWNLOAD_PATH = "/api/wordpress/plugin";

export type ConnectorState =
  | "up-to-date"
  | "update-required"
  | "connection-lost"
  | "not-installed";

export type ConnectorStatus = {
  state: ConnectorState;
  /** The label the badge shows, mark included. */
  label: string;
  /** Whether reinstalling or re-pasting the token is the next useful action. */
  needsReconnect: boolean;
};

const LABELS: Record<ConnectorState, string> = {
  "up-to-date": "Up to date",
  "update-required": "Update required",
  "connection-lost": "Connection lost",
  "not-installed": "Not installed",
};

/** Compares dotted versions without assuming equal segment counts. */
export function isAtLeast(installed: string, required: string): boolean {
  const a = installed.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = required.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Which of the four states the site is in.
 *
 * Order matters. "Not installed" is checked before anything about versions,
 * because a site with no connector has no installed version to be behind — and
 * telling someone their plugin needs updating when they have never installed
 * one sends them looking for a plugin screen that is empty.
 */
export function connectorStatus(input: {
  /** The verify endpoint's reason code. */
  reason: string;
  /** Version the site reports, or null when it did not answer. */
  installed: string | null;
  /** Version this app ships. */
  latest: string;
}): ConnectorStatus {
  const { reason, installed, latest } = input;

  if (reason === "NOT_CONFIGURED" || reason === "PLUGIN_NOT_ACTIVE") {
    return { state: "not-installed", label: LABELS["not-installed"], needsReconnect: true };
  }

  if (reason === "OUTDATED_PLUGIN") {
    return {
      state: "update-required",
      label: LABELS["update-required"],
      needsReconnect: false,
    };
  }

  if (reason !== "OK") {
    return {
      state: "connection-lost",
      label: LABELS["connection-lost"],
      needsReconnect: true,
    };
  }

  /*
   * The site answered cleanly. It can still be behind: the verify endpoint
   * only raises OUTDATED_PLUGIN when the site reports a version it can compare,
   * and an install too old to report one at all comes back as "unknown".
   */
  if (installed === null || installed === "" || installed === "unknown") {
    return {
      state: "update-required",
      label: LABELS["update-required"],
      needsReconnect: false,
    };
  }

  return isAtLeast(installed, latest)
    ? { state: "up-to-date", label: LABELS["up-to-date"], needsReconnect: false }
    : { state: "update-required", label: LABELS["update-required"], needsReconnect: false };
}
