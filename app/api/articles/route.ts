import { NextResponse } from "next/server";
import { z } from "zod";

import { markdownWords, type ArticleStatus } from "@/lib/articles";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

export const maxDuration = 60;

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  keyword: z.string().trim().min(1).max(200),
  country: z.string().min(2).max(5).default("us"),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");

  const articles = await prisma.article.findMany({
    where: {
      userId: session.userId,
      ...(projectId !== null && isValidId(projectId) ? { projectId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      keyword: true,
      status: true,
      content: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      keyword: a.keyword,
      status: a.status as ArticleStatus,
      updatedAt: a.updatedAt.toISOString(),
      words: markdownWords(a.content),
    })),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { projectId, title, keyword, country } = parsed.data;

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

  const article = await prisma.article.create({
    data: {
      userId: session.userId,
      projectId,
      title,
      keyword: keyword.toLowerCase(),
      country,
      status: "preparing",
    },
    select: { id: true },
  });

  // Research is *not* kicked off here. Detached work does not survive a
  // serverless function — the response ends the invocation — so the editor
  // calls /prepare and waits for it inside a live request instead.
  return NextResponse.json({ id: article.id }, { status: 201 });
}
