import { NextResponse } from "next/server";
import { z } from "zod";

import { applyAltFix, loadMedia } from "@/lib/audit/fix-alt";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCredentials } from "@/lib/wordpress/sync";

/**
 * Write alt text onto the media item behind one audited image.
 *
 * The audit reports a URL on a crawled page; the connector writes to a media
 * ID. Everything before the write here exists to make sure those two are the
 * same thing, and that they belong to the caller:
 *
 *   session -> project ownership -> audit belongs to project ->
 *   page belongs to audit -> image was actually flagged on that page
 *
 * Skipping any of those would let a crafted request set alt text on an
 * arbitrary media item on a site the caller does not own, using the owner's
 * stored token. The last check is the narrow one that matters most: only an
 * image this audit actually objected to can be written to.
 *
 * Idempotent by construction. The connector reports whether the value changed,
 * so pressing Fix twice returns "already" rather than writing again.
 */

const schema = z.object({
  auditId: z.string().min(1),
  /** The audited page the image was found on. */
  pageUrl: z.string().min(1),
  /** The image's src, exactly as the audit recorded it. */
  src: z.string().min(1),
  alt: z.string().min(1).max(500),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { auditId, pageUrl, src, alt } = parsed.data;

  /*
   * One query establishes the whole chain: the page, its audit, and the
   * project that owns it. A page that does not belong to this user's project
   * simply is not found, which is also the right answer to give.
   */
  const page = await prisma.auditPage.findFirst({
    where: {
      auditId,
      url: pageUrl,
      project: { userId: session.userId },
    },
    select: {
      id: true,
      url: true,
      projectId: true,
      imagesMissingAltSrc: true,
      project: { select: { id: true, url: true } },
    },
  });

  if (page === null) {
    return NextResponse.json(
      { error: "That page is not part of one of your audits." },
      { status: 404 },
    );
  }

  /*
   * The image has to be one this audit flagged on this page. Without it the
   * route would happily write to any media item whose src the caller guessed.
   */
  if (!page.imagesMissingAltSrc.includes(src)) {
    return NextResponse.json(
      {
        error:
          "That image was not flagged on this page. Re-run the crawl if the page has changed.",
        state: "manual_review",
      },
      { status: 409 },
    );
  }

  const creds = await getCredentials(page.projectId);
  if (creds === null) {
    return NextResponse.json(
      { error: "Connect the WordPress connector for this project first." },
      { status: 409 },
    );
  }

  try {
    const media = await loadMedia(creds.siteUrl, creds.token);
    const result = await applyAltFix({
      siteUrl: creds.siteUrl,
      token: creds.token,
      src,
      alt,
      media,
    });

    if (result.state === "fixed" || result.state === "already") {
      /*
       * The image is no longer a defect, so it stops being one in the stored
       * audit too. The count moves with the list: leaving "2 of 21 missing"
       * next to one remaining image is how a dashboard starts lying.
       */
      const remaining = page.imagesMissingAltSrc.filter((s) => s !== src);
      await prisma.auditPage.update({
        where: { id: page.id },
        data: {
          imagesMissingAltSrc: remaining,
          imagesMissingAlt: remaining.length,
        },
      });

      return NextResponse.json({
        state: result.state,
        message: result.message,
        mediaId: result.mediaId,
        alt: result.alt,
        remaining: remaining.length,
      });
    }

    return NextResponse.json(
      { state: result.state, error: result.message },
      { status: result.state === "manual_review" ? 409 : 502 },
    );
  } catch {
    return NextResponse.json(
      { state: "failed", error: "Could not reach WordPress." },
      { status: 502 },
    );
  }
}
