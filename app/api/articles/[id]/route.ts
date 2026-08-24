import { NextResponse } from "next/server";
import { z } from "zod";

import { ARTICLE_STATUSES } from "@/lib/articles";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { parseEditorial } from "@/lib/drafter/editorial";
import { parseRecipe } from "@/lib/drafter/recipe";

const editorialSchema = z.object({
  excerpt: z.string().max(2_000).optional(),
  slug: z.string().max(120).optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(400).optional(),
  featuredImageUrl: z.string().max(2_000).optional(),
  featuredAssetId: z.string().max(80).optional(),
  categories: z.array(z.string().max(80)).max(20).optional(),
  tags: z.array(z.string().max(80)).max(30).optional(),
  dismissedTerms: z.array(z.string().max(80)).max(80).optional(),
  protectedVocab: z.array(z.string().max(80)).max(80).optional(),
});

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(400_000).optional(),
    status: z.enum(ARTICLE_STATUSES).optional(),
    comments: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          quote: z.string().max(2_000),
          note: z.string().trim().min(1).max(4_000),
        }),
      )
      .max(80)
      .optional(),
    editorial: editorialSchema.optional(),
    /*
     * Recipe fields are author-typed and go straight into structured data, so
     * they are bounded but not otherwise reshaped here — `parseRecipe` on the
     * way out is what guarantees the stored shape.
     */
    recipeCard: z
      .object({
        name: z.string().max(200),
        description: z.string().max(2_000),
        imageUrl: z.string().max(2_000),
        author: z.string().max(120),
        prepMinutes: z.number().int().min(0).max(100_000),
        cookMinutes: z.number().int().min(0).max(100_000),
        recipeYield: z.string().max(120),
        category: z.string().max(120),
        cuisine: z.string().max(120),
        keywords: z.string().max(500),
        ingredients: z.array(z.string().max(500)).max(200),
        steps: z
          .array(z.object({ text: z.string().max(2_000), name: z.string().max(200) }))
          .max(200),
        calories: z.number().int().min(0).max(100_000),
        suitableForDiet: z.array(z.string().max(60)).max(20),
      })
      .partial()
      .optional(),
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

/**
 * The current state of one article.
 *
 * Exists so the editor can pick up a draft that was written by a background
 * job rather than by the request it is sitting in. Everything the editor holds
 * in React state comes back here, so "generation finished" is one fetch rather
 * than a page reload that would throw away the author's scroll position and
 * any edit they were making while it ran.
 */
export async function GET(_req: Request, { params }: Params) {
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
    select: {
      id: true,
      title: true,
      content: true,
      status: true,
      phase: true,
      editorial: true,
      recipeCard: true,
      updatedAt: true,
    },
  });

  if (article === null) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: article.id,
    title: article.title,
    content: article.content,
    status: article.status,
    phase: article.phase,
    editorial: parseEditorial(article.editorial),
    recipeCard: parseRecipe(article.recipeCard),
    updatedAt: article.updatedAt.toISOString(),
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

  const { editorial, recipeCard, title, content, status, comments } = parsed.data;

  // Both JSON columns are merged rather than replaced, so a panel that only
  // knows about its own fields cannot wipe the other's.
  const current =
    editorial || recipeCard
      ? await prisma.article.findUnique({
          where: { id },
          select: { editorial: true, recipeCard: true },
        })
      : null;

  const updated = await prisma.article.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(comments !== undefined ? { comments } : {}),
      ...(editorial
        ? {
            editorial: {
              ...parseEditorial(current?.editorial),
              ...editorial,
            },
          }
        : {}),
      ...(recipeCard
        ? { recipeCard: { ...parseRecipe(current?.recipeCard), ...recipeCard } }
        : {}),
    },
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
