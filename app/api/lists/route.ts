import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { parseListKeywords } from "@/lib/keywords/list-types";
import { INTENTS } from "@/lib/keywords/types";

const keywordSchema = z.object({
  keyword: z.string().min(1).max(200),
  volume: z.number().nonnegative(),
  difficulty: z.number().min(0).max(100),
  cpc: z.number().nonnegative(),
  competition: z.number().min(0).max(1),
  intent: z.enum(INTENTS),
  opportunity: z.number().min(0).max(100),
});

const schema = z.object({
  projectId: z.string().min(1),
  /** Existing list id, or a new name. */
  listId: z.string().optional(),
  name: z.string().min(1).max(100).optional(),
  country: z.string().length(2).default("us"),
  keywords: z.array(keywordSchema).min(1).max(1000),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId");

  const lists = await prisma.keywordList.findMany({
    where: {
      userId: session.userId,
      ...(projectId !== null && isValidId(projectId) ? { projectId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      country: l.country,
      count: parseListKeywords(l.keywords).length,
      updatedAt: l.updatedAt.toISOString(),
    })),
  });
}

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

  const { projectId, listId, name, country, keywords } = parsed.data;

  if (!isValidId(projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // The project must belong to this user.
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.userId },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const entries = keywords.map((k) => ({
    ...k,
    addedAt: new Date().toISOString(),
  }));

  // Append to an existing list, skipping keywords already in it.
  if (listId !== undefined && listId !== "") {
    if (!isValidId(listId)) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const list = await prisma.keywordList.findFirst({
      where: { id: listId, userId: session.userId, projectId },
    });

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const current = parseListKeywords(list.keywords);
    const existing = new Set(current.map((k) => k.keyword));
    const added = entries.filter((k) => !existing.has(k.keyword));

    await prisma.keywordList.update({
      where: { id: list.id },
      data: { keywords: [...current, ...added] },
    });

    return NextResponse.json({
      id: list.id,
      added: added.length,
      skipped: entries.length - added.length,
    });
  }

  // Otherwise create a new list.
  if (name === undefined || name.trim() === "") {
    return NextResponse.json({ error: "Enter a list name" }, { status: 400 });
  }

  const clash = await prisma.keywordList.findUnique({
    where: { projectId_name: { projectId, name: name.trim() } },
  });

  if (clash) {
    return NextResponse.json(
      { error: "A list with this name already exists in this project" },
      { status: 409 },
    );
  }

  const created = await prisma.keywordList.create({
    data: {
      userId: session.userId,
      projectId,
      name: name.trim(),
      country,
      keywords: entries,
    },
  });

  return NextResponse.json(
    { id: created.id, added: entries.length, skipped: 0 },
    { status: 201 },
  );
}
