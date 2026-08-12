import { notFound } from "next/navigation";

import { ArticleEditor } from "@/components/articles/article-editor";
import { parseBrief, type ArticleStatus } from "@/lib/articles";
import { aiEnabled } from "@/lib/ai";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

export const metadata = { title: "Article · Snaily SEO" };

export default async function ArticlePage({
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
    },
  });

  if (!article) notFound();

  return (
    <ArticleEditor
      article={{
        id: article.id,
        title: article.title,
        keyword: article.keyword,
        status: article.status as ArticleStatus,
        content: article.content,
      }}
      brief={parseBrief(article.brief)}
      briefError={article.briefError}
      aiEnabled={aiEnabled()}
    />
  );
}
