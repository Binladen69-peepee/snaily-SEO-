import { notFound } from "next/navigation";

import { ArticleEditor } from "@/components/articles/article-editor";
import {
  parseBrief,
  parseComments,
  type ArticleMode,
  type ArticlePhase,
  type ArticleStatus,
} from "@/lib/articles";
import { parseEditorial, parseRevisions } from "@/lib/drafter/editorial";
import { parseRecipe } from "@/lib/drafter/recipe";
import { aiEnabled } from "@/lib/ai";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { getGoogleAccountPublic } from "@/lib/google/account";
import { wordpressHealthFromRow } from "@/lib/setup/state";

export const metadata = { title: "Edit post · Snaily SEO" };

export default async function PostEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  if (!session || !isValidId(id)) notFound();

  const article = await prisma.article.findFirst({
    where: { id, userId: session.userId },
    select: {
      id: true,
      title: true,
      keyword: true,
      status: true,
      content: true,
      brief: true,
      briefError: true,
      mode: true,
      phase: true,
      comments: true,
      driveFileUrl: true,
      wpEditLink: true,
      wpDraftId: true,
      wpSyncedAt: true,
      editorial: true,
      recipeCard: true,
      revisions: true,
      projectId: true,
      project: { select: { driveFolderId: true, url: true } },
    },
  });

  if (!article) notFound();

  const [wp, google] = await Promise.all([
    prisma.wordPressConnection.findUnique({
      where: { projectId: article.projectId },
      select: { lastError: true },
    }),
    getGoogleAccountPublic(session.userId),
  ]);

  const wpHealth = wordpressHealthFromRow(wp);

  const phase: ArticlePhase | "" =
    article.phase === "outline" ||
    article.phase === "draft" ||
    article.phase === "proofed"
      ? article.phase
      : "";

  return (
    <ArticleEditor
      article={{
        id: article.id,
        title: article.title,
        keyword: article.keyword,
        status: article.status as ArticleStatus,
        content: article.content,
        mode: (article.mode === "drafter" ? "drafter" : "optimize") as ArticleMode,
        phase,
        driveFileUrl: article.driveFileUrl,
        wpEditLink: article.wpEditLink,
        wpDraftId: article.wpDraftId,
        wpSyncedAt: article.wpSyncedAt?.toISOString() ?? null,
        projectId: article.projectId,
        siteUrl: article.project.url,
      }}
      comments={parseComments(article.comments)}
      brief={parseBrief(article.brief)}
      briefError={article.briefError}
      editorial={parseEditorial(article.editorial)}
      recipeCard={parseRecipe(article.recipeCard)}
      revisions={parseRevisions(article.revisions)}
      aiEnabled={aiEnabled()}
      wpHealth={wpHealth}
      hasDrive={google?.hasDrive ?? false}
      driveFolderId={article.project.driveFolderId}
    />
  );
}
