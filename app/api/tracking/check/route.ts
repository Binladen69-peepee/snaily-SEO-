import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { checkRanks, domainOf, listTracked } from "@/lib/rank-tracker";

/** Each keyword is a live SERP fetch; a batch needs the long slice. */
export const maxDuration = 60;

const schema = z.object({
  projectId: z.string().min(1),
  /** Omit to check everything currently tracked. */
  ids: z.array(z.string().min(1)).max(25).optional(),
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

  const { projectId, ids } = parsed.data;
  if (!isValidId(projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.userId },
    select: { url: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Restrict to this user's keywords whichever ids were asked for.
  const targets = await prisma.trackedKeyword.findMany({
    where: {
      projectId,
      userId: session.userId,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    select: { id: true },
    // A hard ceiling so one click can never drain the monthly SERP allowance.
    take: 25,
  });

  const result = await checkRanks(
    targets.map((t) => t.id),
    domainOf(project.url),
  );

  if (result.error !== undefined) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json({
    ...result,
    keywords: await listTracked(projectId, session.userId),
  });
}
