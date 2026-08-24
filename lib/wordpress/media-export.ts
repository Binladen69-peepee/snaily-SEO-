import { prisma } from "@/lib/db";
import { uploadMedia, WordPressError } from "@/lib/wordpress/client";

const ASSET_RE = /\/api\/articles\/[^/"']+\/media\/([a-z0-9]+)/gi;

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

/**
 * Upload Drafter-hosted images to WordPress media and rewrite those URLs in
 * the HTML. Already-exported assets reuse wpUrl so we do not duplicate.
 *
 * If the installed plugin has no /media route yet, images are left as-is and
 * the draft still goes out — the connection is not treated as lost.
 */
export async function rewriteImagesForWordPress(opts: {
  html: string;
  articleId: string;
  siteUrl: string;
  token: string;
}): Promise<{ html: string; uploaded: number; featuredMedia: number | null }> {
  const ids = [...new Set([...opts.html.matchAll(ASSET_RE)].map((m) => m[1]!))];
  if (ids.length === 0) {
    return { html: opts.html, uploaded: 0, featuredMedia: null };
  }

  const assets = await prisma.articleAsset.findMany({
    where: { articleId: opts.articleId, id: { in: ids } },
  });

  let html = opts.html;
  let uploaded = 0;
  let featuredMedia: number | null = null;

  for (const asset of assets) {
    let wpId = asset.wpMediaId;
    let wpUrl = asset.wpUrl;
    if (!wpId || wpUrl === "") {
      try {
        const remote = await uploadMedia(opts.siteUrl, opts.token, {
          filename: asset.filename,
          data: toBase64(asset.data),
          alt: asset.alt,
          caption: asset.caption,
        });
        wpId = remote.id;
        wpUrl = remote.url;
        uploaded += 1;
        await prisma.articleAsset.update({
          where: { id: asset.id },
          data: { wpMediaId: wpId, wpUrl },
        });
      } catch (err) {
        if (err instanceof WordPressError && err.kind === "route_missing") {
          break;
        }
        throw err;
      }
    }
    if (featuredMedia === null && wpId) featuredMedia = wpId;
    if (wpUrl) {
      const local = `/api/articles/${opts.articleId}/media/${asset.id}`;
      html = html.split(local).join(wpUrl);
    }
  }

  return { html, uploaded, featuredMedia };
}
