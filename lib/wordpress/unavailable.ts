/**
 * Client-safe classifier for WordPress connector failures.
 *
 * Kept free of Prisma / crypto so UI surfaces can reuse it without pulling
 * the health ping into the browser bundle.
 *
 * Only genuine handshake failures count as "plugin unavailable". A 404 on a
 * newer route (media, update-draft) or a 403 on a published post is an
 * export problem, not a lost connection.
 */
export function isPluginUnavailable(message: string): boolean {
  return /plugin was not found|not found on that site|could not reach the site|plugin not activated|stored credentials could not be read/i.test(
    message,
  );
}

export function isOutdatedPlugin(message: string): boolean {
  return /connector is out of date|does not support that action|update the snaily seo plugin/i.test(
    message,
  );
}

export function isNotADraft(message: string): boolean {
  return /only update drafts|not_a_draft|still a draft/i.test(message);
}
