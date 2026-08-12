import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { addKeywords, listTracked } from "@/lib/rank-tracker";

const addSchema = z.object({
  projectId: z.string().min(1),
  keywords: z.array(z.string().min(1).max(200)).min(1).max(200),
  engine: z.string().min(3).max(40).default("google.com"),
  country: z.string().min(2).max(5).default("us"),
  location: z.string().max(120).nullable().optional(),
  groupName: z.string().max(60).nullable().optional(),
});

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

async function ownsProject(userId: string, projectId: string) {
  if (!isValidId(projectId)) return false;
  return (
    (await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    })) !== null
  );
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!(await ownsProject(session.userId, projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({
    keywords: await listTracked(projectId, session.userId),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = addSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { projectId, keywords, engine, country, location, groupName } =
    parsed.data;

  if (!(await ownsProject(session.userId, projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const added = await addKeywords(
    session.userId,
    projectId,
    keywords,
    engine,
    country,
    location?.trim() === "" ? null : (location ?? null),
    groupName?.trim() === "" ? null : (groupName ?? null),
  );

  return NextResponse.json({
    added,
    skipped: keywords.length - added,
    keywords: await listTracked(projectId, session.userId),
  });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = deleteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Scoped to the caller so an id from another account cannot be removed.
  const { count } = await prisma.trackedKeyword.deleteMany({
    where: { id: { in: parsed.data.ids }, userId: session.userId },
  });

  return NextResponse.json({ deleted: count });
}
