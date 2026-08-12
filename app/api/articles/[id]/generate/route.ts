import { NextResponse } from "next/server";
import { z } from "zod";

import { AiError, generate, toBlocks } from "@/lib/ai";
import { parseBrief } from "@/lib/articles";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { resolveImageMarkers } from "@/lib/images";

export const maxDuration = 60;

const schema = z.object({
  instruction: z.string().trim().min(3).max(2000),
});

export async function POST(
  req: Request,
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
    select: { title: true, keyword: true, content: true, brief: true },
  });

  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const brief = parseBrief(article.brief);

  try {
    const markdown = await generate({
      instruction: parsed.data.instruction,
      title: article.title,
      keyword: article.keyword,
      // Steer the model with the terms the ranking pages agree on, heaviest
      // first — the same list the writer is working through by hand.
      terms: (brief?.terms ?? []).slice(0, 25).map((t) => t.term),
      headings: (brief?.headings ?? []).map((h) => h.text),
      questions: brief?.questions ?? [],
      existing: article.content,
    });

    // Swap the model's image markers for real, licensed pictures before the
    // draft ever reaches the editor.
    const withImages = await resolveImageMarkers(markdown);

    return NextResponse.json({ blocks: toBlocks(withImages) });
  } catch (err) {
    if (err instanceof AiError) {
      // 503 when the operator must change configuration, 502 when the upstream
      // simply failed — the client shows the message either way.
      return NextResponse.json(
        { error: err.message },
        { status: err.configurable ? 503 : 502 },
      );
    }
    return NextResponse.json(
      { error: "Could not generate content right now." },
      { status: 502 },
    );
  }
}
