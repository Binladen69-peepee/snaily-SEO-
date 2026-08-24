import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { syncAffiliateLinksFromWordPress } from "@/lib/content/affiliate";
import { isValidId, prisma } from "@/lib/db";

/**
 * Pulls affiliate links from the project's WordPress install.
 *
 * The author manages links in Easy Affiliate Links and this reads them, so
 * adding a link in WordPress is all that is required — no spreadsheet, no
 * re-import. Rows imported from the CSV are left untouched, so the two can
 * coexist while the client decides whether to retire the sheet.
 */

export const maxDuration = 60;

const schema = z.object({ projectId: z.string().min(1) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success || !isValidId(parsed.data.projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, userId: session.userId },
    select: { id: true, url: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  /*
   * The site's own URL, not the connector's. This reads public REST routes, so
   * it needs no plugin and no token — and therefore must not borrow one.
   */
  const result = await syncAffiliateLinksFromWordPress(project.id, project.url);

  if (result.imported === 0) {
    return NextResponse.json(
      {
        error:
          result.reason ??
          "No affiliate links found on the site. Easy Affiliate Links may not be installed.",
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
