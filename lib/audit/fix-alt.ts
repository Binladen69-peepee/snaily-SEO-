/**
 * The one Content Intelligence fix that writes to WordPress.
 *
 * Everything else the audit reports needs a judgement call — which duplicate
 * title to change, what a short page should say, whether a 404 should be
 * restored or redirected — and a button that guesses at those would be worse
 * than no button. Alt text is the exception, and only halfway: the *text* is
 * still the author's, but once they have written it, putting it on the right
 * image is deterministic, verifiable and reversible.
 *
 * The write goes through the connector's media route, which touches one meta
 * key on one attachment and cannot reach a published page's content.
 *
 * Two things are checked before anything is written, because the audit stores
 * URLs and the connector takes IDs, and the step between them is where a fix
 * would otherwise hit the wrong image:
 *
 *   - the image must belong to the site this project is connected to
 *   - the src must resolve to exactly one media item
 */

import { listMedia, setMediaAlt, type WpMediaItem } from "@/lib/wordpress/client";

export type FixState = "fixed" | "already" | "failed" | "manual_review";

export type AltFixResult = {
  state: FixState;
  /** Owner-facing. Never a raw provider error. */
  message: string;
  mediaId?: number;
  /** What WordPress holds now, read back after the write. */
  alt?: string;
};

/**
 * WordPress serves the same image at many URLs.
 *
 * A page references `hero-2-1024x683.jpg`; the media library knows it as
 * `hero-2.jpg`. Matching on the full URL finds nothing, so the size suffix and
 * the extension come off before comparing, and the origin is ignored because a
 * page may reference the CDN host while the library reports the canonical one.
 */
export function mediaKey(url: string): string {
  let path = url;
  try {
    path = new URL(url, "https://example.invalid").pathname;
  } catch {
    // Already a path.
  }
  const file = path.split("/").pop() ?? path;
  return file
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    // WordPress appends -WIDTHxHEIGHT to every generated size.
    .replace(/-\d{2,5}x\d{2,5}$/, "")
    // And -scaled to anything it shrank on upload.
    .replace(/-scaled$/, "")
    .trim();
}

/**
 * Find the media item an image src refers to.
 *
 * Returns null when nothing matches, and null when more than one does —
 * an ambiguous match is exactly the case where a fix must not proceed.
 */
export function matchMedia(
  src: string,
  media: WpMediaItem[],
): WpMediaItem | null {
  const key = mediaKey(src);
  if (key === "") return null;

  const hits = media.filter((m) => mediaKey(m.url) === key);
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/** True when the image is served by the site this project is connected to. */
export function belongsToSite(src: string, siteUrl: string): boolean {
  try {
    const image = new URL(src, siteUrl);
    const site = new URL(siteUrl);
    const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
    return strip(image.hostname) === strip(site.hostname);
  } catch {
    return false;
  }
}

/**
 * Apply alt text to the media item behind one image.
 *
 * `media` is the caller's already-fetched library page(s) — resolving the src
 * is a lookup, not another round trip per fix.
 */
export async function applyAltFix(opts: {
  siteUrl: string;
  token: string;
  src: string;
  alt: string;
  media: WpMediaItem[];
  /**
   * The connector call, injectable so the refusal paths can be tested without
   * a WordPress. A test that has to reach a real site to prove a fix was
   * *refused* is a test nobody runs.
   */
  setMediaAltImpl?: typeof setMediaAlt;
}): Promise<AltFixResult> {
  const write = opts.setMediaAltImpl ?? setMediaAlt;
  const alt = opts.alt.trim();

  if (alt === "") {
    return { state: "failed", message: "Alt text cannot be empty." };
  }
  if (alt.length > 500) {
    return { state: "failed", message: "Alt text is limited to 500 characters." };
  }

  if (!belongsToSite(opts.src, opts.siteUrl)) {
    return {
      state: "manual_review",
      message:
        "That image is hosted somewhere else, so it cannot be edited from here.",
    };
  }

  const item = matchMedia(opts.src, opts.media);
  if (item === null) {
    return {
      state: "manual_review",
      message:
        "No single media item matches that image, so there is nothing safe to write to.",
    };
  }

  try {
    const result = await write(opts.siteUrl, opts.token, item.id, alt);

    if (!result.persisted) {
      // A 200 that did not change anything is a failure, and saying so is the
      // whole reason the connector reads the value back.
      return {
        state: "failed",
        message: "WordPress accepted the change but did not store it.",
        mediaId: item.id,
        alt: result.alt,
      };
    }

    return {
      // Writing the same text twice is success, not a second edit.
      state: result.unchanged ? "already" : "fixed",
      message: result.unchanged
        ? "That image already had this alt text."
        : "Alt text saved and confirmed in WordPress.",
      mediaId: item.id,
      alt: result.alt,
    };
  } catch (err) {
    const kind = (err as { kind?: string }).kind;
    if (kind === "route_missing") {
      return {
        state: "failed",
        message:
          "This needs connector 1.5.0. Download the latest connector and try again.",
      };
    }
    return { state: "failed", message: "Could not reach WordPress." };
  }
}

/** Fetch enough of the media library to resolve fixes against. */
export async function loadMedia(
  siteUrl: string,
  token: string,
  maxPages = 8,
): Promise<WpMediaItem[]> {
  const all: WpMediaItem[] = [];
  let page = 1;
  let pages = 1;

  while (page <= Math.min(pages, maxPages)) {
    const batch = await listMedia(siteUrl, token, page);
    all.push(...batch.items);
    pages = batch.pages || 1;
    page += 1;
  }

  return all;
}
