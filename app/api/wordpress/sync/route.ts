import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { WordPressError } from "@/lib/wordpress/client";
import { isPluginUnavailable } from "@/lib/wordpress/unavailable";
import { syncPosts } from "@/lib/wordpress/sync";

/** A first sync on a content-heavy site pulls up to 1,000 posts. */
export const maxDuration = 60;

const schema = z.object({
  projectId: z.string().min(1),
  /** Ignores the incremental cursor and re-reads everything. */
  full: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success || !isValidId(parsed.data.projectId)) {
    return NextResponse.json({ error: "Project required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, userId: session.userId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const result = await syncPosts(project.id, { full: parsed.data.full });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WordPressError) {
      console.error("[wordpress sync]", err.message);
      const lost = isPluginUnavailable(err.message);
      return NextResponse.json(
        {
          error: lost ? "WordPress setup is incomplete" : err.message,
          setupIncomplete: lost,
          reason: lost ? "connection_lost" : "sync_failed",
        },
        { status: lost ? 409 : 400 },
      );
    }
    return NextResponse.json({ error: "Sync failed" }, { status: 502 });
  }
}
