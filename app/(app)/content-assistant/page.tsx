import Link from "next/link";

import { ArticlesView } from "@/components/articles/articles-view";
import { markdownWords, type ArticleRow, type ArticleStatus } from "@/lib/articles";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Drafter · Snaily SEO" };

export default async function ContentAssistantPage() {
  const [session, project] = await Promise.all([
    getSession(),
    getActiveProject(),
  ]);

  const rows =
    session && project
      ? await prisma.article.findMany({
          where: { userId: session.userId, projectId: project.id },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            title: true,
            keyword: true,
            status: true,
            content: true,
            mode: true,
            phase: true,
            updatedAt: true,
          },
        })
      : [];

  const articles: ArticleRow[] = rows.map((a) => ({
    id: a.id,
    title: a.title,
    keyword: a.keyword,
    status: a.status as ArticleStatus,
    updatedAt: a.updatedAt.toISOString(),
    words: markdownWords(a.content),
    mode: a.mode === "drafter" ? "drafter" : "optimize",
    phase: a.phase === "outline" || a.phase === "draft" || a.phase === "proofed" ? a.phase : "",
  }));

  if (!project) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Drafter</h1>
        <div className="mt-5 rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center">
          <p className="font-medium">Create a project first</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Articles belong to a site.{" "}
            <Link href="/projects" className="text-primary hover:underline">
              Add your site
            </Link>{" "}
            and you can start writing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ArticlesView
      initial={articles}
      projectId={project.id}
      projectName={project.name}
    />
  );
}
