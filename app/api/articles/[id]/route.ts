import { NextResponse } from "next/server";
import { z } from "zod";

import { ARTICLE_STATUSES } from "@/lib/articles";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(200_000).optional(),
    status: z.enum(ARTICLE_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Nothing to update",
  });

type Params = { params: Promise<{ id: string }> };

/** Confirms the article exists and belongs to the caller. */
async function own(id: string, userId: string) {
  if (!isValidId(id)) return null;
  return prisma.article.findFirst({
    where: { id, userId },
    select: { id: true },
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await own(id, session.userId))) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const body: unknown = await req.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const updated = await prisma.article.update({
    where: { id },
    data: parsed.data,
    select: { id: true, updatedAt: true },
  });

  return NextResponse.json({
    ok: true,
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await own(id, session.userId))) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  await prisma.article.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
