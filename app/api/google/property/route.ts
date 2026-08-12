import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

const schema = z.object({
  projectId: z.string().min(1),
  /** Search Console site URL, or null to unlink. */
  gscSiteUrl: z.string().max(500).nullable().optional(),
  gscSiteName: z.string().max(500).nullable().optional(),
  /** GA4 resource name like "properties/123456", or null to unlink. */
  ga4PropertyId: z.string().max(200).nullable().optional(),
  ga4PropertyName: z.string().max(500).nullable().optional(),
});

/**
 * Links Google properties to a project.
 *
 * Stored on the project, not against a credential, so each project can point
 * at a different property under the same Google account and the mapping
 * survives every future sign-in.
 */
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

  const { projectId, ...fields } = parsed.data;
  if (!isValidId(projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.userId },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { ...fields, googleSyncError: null },
    select: {
      gscSiteUrl: true,
      gscSiteName: true,
      ga4PropertyId: true,
      ga4PropertyName: true,
    },
  });

  return NextResponse.json({ ok: true, project: updated });
}
