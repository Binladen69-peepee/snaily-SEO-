import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { parseRevisions, pushRevision } from "@/lib/drafter/editorial";

type Params = { params: Promise<{ id: string }> };

const restoreSchema = z.object({
  revisionId: z.string().min(1).max(80),
});

export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const article = await prisma.article.findFirst({
    where: { id, userId: session.userId },
    select: { id: true, title: true, content: true, revisions: true },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const body: unknown = await req.json();
  const parsed = restoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a revision to restore." }, { status: 400 });
  }

  const list = parseRevisions(article.revisions);
  const found = list.find((r) => r.id === parsed.data.revisionId);
  if (!found) {
    return NextResponse.json({ error: "That revision is gone." }, { status: 404 });
  }

  const revisions = pushRevision(list, {
    kind: "restore",
    title: article.title,
    content: article.content,
  });

  await prisma.article.update({
    where: { id: article.id },
    data: {
      title: found.title || article.title,
      content: found.content,
      revisions,
    },
  });

  return NextResponse.json({
    title: found.title || article.title,
    content: found.content,
    revisions,
  });
}
