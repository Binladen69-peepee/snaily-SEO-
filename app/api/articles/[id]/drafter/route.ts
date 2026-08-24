import { NextResponse } from "next/server";
import { z } from "zod";

import { AiError } from "@/lib/ai";
import {
  parseBrief,
  parseComments,
  type ArticlePhase,
} from "@/lib/articles";
import { proofPost, redraftPost } from "@/lib/drafter/generate";
import { parseEditorial, pushRevision } from "@/lib/drafter/editorial";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { toEditorHtml } from "@/lib/markdown";
import {
  applyAffiliateLinks,
  buildAffiliateIndex,
} from "@/lib/content/affiliate";
import { buildLinkIndex, resolveLinks } from "@/lib/content/link-index";
import { checkDraftQuality } from "@/lib/drafter/quality-gate";
import { tightenParagraphs } from "@/lib/drafter/tighten";

export const maxDuration = 60;

/**
 * Points every internal link at a page that actually exists.
 *
 * The model writes relative Markdown targets from the section playbook, and
 * those slugs are guesses. Anything that matches a synced post becomes a real
 * permalink; anything that does not loses its anchor and stays as plain words,
 * because a broken link costs more than a missing one.
 */
async function linkify(projectId: string, html: string): Promise<string> {
  let out = html;

  try {
    const index = await buildLinkIndex(projectId);
    // With nothing synced there is nothing to verify against, so leaving the
    // anchors alone beats stripping every link the author might have written.
    if (index.all.length > 0) out = resolveLinks(out, index).html;
  } catch {
    /* Leave the draft's own links alone if the index cannot be built. */
  }

  /*
   * Ingredient links, from the author's spreadsheet. Runs after the internal
   * link pass so it can see — and skip — anchors that pass already created,
   * and it is confined to the ingredients section and recipe card.
   */
  try {
    const affiliates = await buildAffiliateIndex(projectId);
    if (affiliates.terms.length > 0) {
      out = applyAffiliateLinks(out, affiliates).html;
    }
  } catch {
    /* A missing spreadsheet must never cost the author their draft. */
  }

  return out;
}

/*
 * "outline" is gone.
 *
 * It was the whole-article-in-one-request path, and it is the reason drafts
 * came out at 800 words: a single call that has to carry the style guide, the
 * section playbook, six sample posts and the recipe has a few thousand tokens
 * left to write with, and no amount of prompt tuning changes that arithmetic.
 * Writing now happens in `/api/articles/[id]/draft-job`, across as many bounded
 * calls as the post needs.
 *
 * Redraft and proofread stay here. They are things the author asks for on a
 * draft they are reading, which is a live request with a finished document in
 * it, not a pipeline.
 */
const schema = z.object({
  action: z.enum(["redraft", "proof"]),
});

type Params = { params: Promise<{ id: string }> };

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
    select: {
      id: true,
      title: true,
      keyword: true,
      content: true,
      recipe: true,
      generated: true,
      comments: true,
      brief: true,
      projectId: true,
      mode: true,
      editorial: true,
      revisions: true,
    },
  });

  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  if (article.mode !== "drafter") {
    return NextResponse.json(
      { error: "This article was not started as a Drafter recipe draft." },
      { status: 400 },
    );
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
  const terms = (brief?.terms ?? []).slice(0, 20).map((t) => t.term);
  const comments = parseComments(article.comments);
  const editorial = parseEditorial(article.editorial);
  const protectedVocab = editorial.protectedVocab;

  try {
    if (parsed.data.action === "redraft") {
      const before = pushRevision(article.revisions, {
        kind: "redraft",
        title: article.title,
        content: article.content,
      });

      const markdown = await redraftPost({
        projectId: article.projectId,
        keyword: article.keyword,
        recipe: article.recipe,
        terms,
        previous: article.generated,
        current: article.content,
        comments,
        protectedVocab,
      });

      const html = await linkify(article.projectId, toEditorHtml(tightenParagraphs(markdown)));
      const phase: ArticlePhase = "draft";

      await prisma.article.update({
        where: { id: article.id },
        data: {
          content: html,
          generated: html,
          comments: [],
          phase,
          status: "in_progress",
          revisions: pushRevision(before, {
            kind: "redraft",
            title: article.title,
            content: html,
          }),
        },
      });

      return NextResponse.json({
        content: html,
        phase,
        comments: [],
        previousContent: article.content,
        quality: checkDraftQuality(html),
      });
    }

    const markdown = await proofPost({
      projectId: article.projectId,
      keyword: article.keyword,
      current: article.content,
      protectedVocab,
    });

    const html = await linkify(article.projectId, toEditorHtml(tightenParagraphs(markdown)));
    const phase: ArticlePhase = "proofed";

    await prisma.article.update({
      where: { id: article.id },
      data: {
        content: html,
        generated: html,
        phase,
        revisions: pushRevision(article.revisions, {
          kind: "proof",
          title: article.title,
          content: html,
        }),
      },
    });

    return NextResponse.json({
      content: html,
      phase,
      previousContent: article.content,
      quality: checkDraftQuality(html),
    });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.configurable ? 503 : 502 },
      );
    }
    return NextResponse.json(
      { error: "Could not draft this right now." },
      { status: 502 },
    );
  }
}
