import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/google/token-crypto";
import {
  fetchPosts,
  verifyConnection,
  WordPressError,
  type WpSiteInfo,
} from "@/lib/wordpress/client";
import { syncCategories } from "@/lib/wordpress/terms";

/**
 * Connecting and syncing a WordPress site.
 *
 * The token is encrypted at rest with the same helper the Google tokens use,
 * and is never sent back to the browser — the UI only ever learns whether a
 * connection exists and when it last ran.
 */

/** A run never pulls more than this, so one sync cannot hang for minutes. */
const MAX_PAGES_PER_SYNC = 20;
const PER_PAGE = 50;

export type ConnectionStatus = {
  connected: boolean;
  siteUrl: string;
  siteName: string;
  seoPlugin: string;
  wpVersion: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  postCount: number;
};

/** Decrypted credentials for server-side calls. Null when not connected. */
export async function getCredentials(
  projectId: string,
): Promise<{ siteUrl: string; token: string } | null> {
  const row = await prisma.wordPressConnection.findUnique({
    where: { projectId },
    select: { siteUrl: true, token: true },
  });
  if (!row) return null;

  try {
    return { siteUrl: row.siteUrl, token: decryptToken(row.token) };
  } catch {
    // A token encrypted under a different AUTH_SECRET can no longer be read.
    return null;
  }
}

export async function getStatus(projectId: string): Promise<ConnectionStatus | null> {
  const [row, postCount] = await Promise.all([
    prisma.wordPressConnection.findUnique({ where: { projectId } }),
    prisma.wpPost.count({ where: { projectId } }),
  ]);

  if (!row) return null;

  return {
    connected: true,
    siteUrl: row.siteUrl,
    siteName: row.siteName,
    seoPlugin: row.seoPlugin,
    wpVersion: row.wpVersion,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    postCount,
  };
}

/** Verifies a pasted token against the site, then stores it. */
export async function connectSite(
  projectId: string,
  siteUrl: string,
  token: string,
): Promise<WpSiteInfo> {
  const info = await verifyConnection(siteUrl, token);

  const data = {
    siteUrl,
    token: encryptToken(token),
    siteName: info.name,
    seoPlugin: info.seoPlugin,
    wpVersion: info.wpVersion,
    lastError: null,
    healthCheckedAt: new Date(),
  };

  await prisma.wordPressConnection.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });

  return info;
}

export async function disconnectSite(projectId: string): Promise<void> {
  // Posts go too: leaving them behind would show stale content as current.
  await prisma.$transaction([
    prisma.wpPost.deleteMany({ where: { projectId } }),
    prisma.wordPressConnection.deleteMany({ where: { projectId } }),
  ]);
}

export type SyncResult = { imported: number; total: number; truncated: boolean };

/**
 * Pulls posts into `WpPost`.
 *
 * Incremental after the first run: only posts modified since the last successful
 * sync are requested, so a routine refresh on a large site costs one page.
 */
export async function syncPosts(
  projectId: string,
  opts: { full?: boolean } = {},
): Promise<SyncResult> {
  const row = await prisma.wordPressConnection.findUnique({
    where: { projectId },
  });
  if (!row) throw new WordPressError("This project is not connected to WordPress.");

  let token: string;
  try {
    token = decryptToken(row.token);
  } catch {
    throw new WordPressError(
      "Stored credentials could not be read. Reconnect the site.",
      true,
      "auth",
    );
  }

  const modifiedAfter = opts.full === true ? null : row.lastSyncedAt;

  let imported = 0;
  let total = 0;
  let pages = 1;
  let page = 1;
  let truncated = false;

  try {
    while (page <= pages && page <= MAX_PAGES_PER_SYNC) {
      const batch = await fetchPosts(row.siteUrl, token, {
        page,
        perPage: PER_PAGE,
        modifiedAfter,
      });

      total = batch.total;
      pages = Math.max(1, batch.pages);

      for (const post of batch.items) {
        const fields = {
          type: post.type,
          status: post.status,
          title: post.title,
          slug: post.slug,
          link: post.link,
          excerpt: post.excerpt,
          content: post.content,
          wordCount: post.wordCount,
          categories: post.categories,
          tags: post.tags,
          author: post.author,
          seoTitle: post.seoTitle,
          seoDescription: post.seoDescription,
          seoScore: post.seoScore,
          focusKeyword: post.focusKeyword,
          publishedAt: post.publishedAt,
          modifiedAt: post.modifiedAt,
        };

        await prisma.wpPost.upsert({
          where: { projectId_wpId: { projectId, wpId: post.id } },
          create: { projectId, wpId: post.id, ...fields },
          update: fields,
        });
        imported += 1;
      }

      if (batch.items.length === 0) break;
      page += 1;
    }

    truncated = pages > MAX_PAGES_PER_SYNC;

    /*
     * Category archives, for the links the "why you'll adore" section makes to
     * a whole group of recipes. Deliberately not fatal: this reads WordPress's
     * public REST API rather than the connector, and a site that has that
     * locked down should still get its posts synced.
     */
    try {
      await syncCategories(projectId, row.siteUrl);
    } catch {
      /* Costs this post its category links and nothing else. */
    }

    await prisma.wordPressConnection.update({
      where: { projectId },
      data: { lastSyncedAt: new Date(), lastError: null, healthCheckedAt: new Date() },
    });
  } catch (err) {
    const message =
      err instanceof WordPressError ? err.message : "The sync failed unexpectedly.";
    await prisma.wordPressConnection.update({
      where: { projectId },
      data: { lastError: message, healthCheckedAt: new Date() },
    });
    throw err instanceof WordPressError ? err : new WordPressError(message);
  }

  return { imported, total, truncated };
}
