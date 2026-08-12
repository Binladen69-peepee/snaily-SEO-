/**
 * Turns raw Google API errors into something a person can act on.
 *
 * Google's messages are long, repeat the project id, and bury the one useful
 * thing — a console URL — in the middle of a paragraph. This pulls that out so
 * the UI can show a short explanation and a button that goes straight there.
 */

export type FriendlyError = {
  title: string;
  detail: string;
  /** Console URL to fix it, when Google gave us one. */
  actionUrl?: string;
  actionLabel?: string;
};

/** Google names the API in the message; map it to a readable label. */
const API_LABELS: Record<string, string> = {
  "searchconsole.googleapis.com": "Google Search Console API",
  "webmasters.googleapis.com": "Google Search Console API",
  "analyticsadmin.googleapis.com": "Google Analytics Admin API",
  "analyticsdata.googleapis.com": "Google Analytics Data API",
};

export function friendlyGoogleError(raw: string): FriendlyError {
  const message = raw.trim();

  // "… API has not been used in project 123 before or it is disabled."
  if (/has not been used in project|it is disabled/i.test(message)) {
    const urlMatch = /https?:\/\/console\.[^\s]+/.exec(message);
    let url = urlMatch?.[0] ?? "";
    // Google appends the sentence's full stop to the URL often enough to matter.
    url = url.replace(/[.,)]+$/, "");

    const host = Object.keys(API_LABELS).find((h) => message.includes(h));
    const apiName = host ? API_LABELS[host]! : "the required Google API";

    return {
      title: `${apiName} is not enabled`,
      detail:
        "Your Google Cloud project has this API switched off. Enable it, wait a minute for Google to propagate the change, then try again.",
      actionUrl: url || undefined,
      actionLabel: "Enable it in Google Cloud",
    };
  }

  if (/insufficient|PERMISSION_DENIED|does not have sufficient permission/i.test(message)) {
    return {
      title: "This Google account lacks access",
      detail:
        "The connected Google account cannot see that property. Sign in with an account that has access to it, or ask the owner to add you.",
    };
  }

  if (/invalid_grant|Token has been expired or revoked/i.test(message)) {
    return {
      title: "Google sign-in expired",
      detail:
        "Access was revoked or timed out. Disconnect and connect again to refresh it.",
    };
  }

  if (/quota|rate limit|RESOURCE_EXHAUSTED/i.test(message)) {
    return {
      title: "Google rate limit reached",
      detail: "Too many requests in a short window. Wait a few minutes and retry.",
    };
  }

  if (/invalid_client|unauthorized_client/i.test(message)) {
    return {
      title: "OAuth client rejected",
      detail:
        "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET does not match the Google Cloud OAuth client.",
    };
  }

  return {
    title: "Google returned an error",
    detail: message.length > 400 ? `${message.slice(0, 400)}…` : message,
  };
}
