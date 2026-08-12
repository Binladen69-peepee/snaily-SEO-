import { NextResponse } from "next/server";

import { parseBrief, prepareArticle } from "@/lib/articles";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

/** Crawling the whole first page of results takes tens of seconds. */
export const maxDuration = 60;

/**
 * Researches an article's keyword, in a request that stays alive until it is
 * done.
 *
 * This exists because detached work does not survive serverless. Kicking the
 * research off with `void prepare(...)` after responding works on a long-lived
 * Node server and silently does nothing on Vercel — the function is frozen the
 * moment the response is sent, so articles sat on "Preparing" forever in
 * production while passing every local test.
 *
 * Safe to call repeatedly: it returns the existing research rather than
 * crawling again, so an open editor, a reload and a second tab cost nothing.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
    select: { id: true, keyword: true, country: true, brief: true },
  });

  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const existing = parseBrief(article.brief);
  if (existing !== null) {
    return NextResponse.json({ brief: existing, briefError: null });
  }

  await prepareArticle(article.id, article.keyword, article.country);

  const updated = await prisma.article.findUnique({
    where: { id: article.id },
    select: { brief: true, briefError: true },
  });

  return NextResponse.json({
    brief: parseBrief(updated?.brief),
    briefError: updated?.briefError ?? null,
  });
}
