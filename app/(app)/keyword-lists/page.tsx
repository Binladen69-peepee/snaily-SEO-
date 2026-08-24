import { ListsView, type ListDetail } from "@/components/keywords/lists-view";
import { PageHeader } from "@/components/tool-shell";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseListKeywords } from "@/lib/keywords/list-types";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Keyword Lists · Snaily SEO" };

async function getLists(): Promise<ListDetail[]> {
  const [session, project] = await Promise.all([
    getSession(),
    getActiveProject(),
  ]);
  if (!session || !project) return [];

  const docs = await prisma.keywordList.findMany({
    where: { userId: session.userId, projectId: project.id },
    orderBy: { updatedAt: "desc" },
  });

  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    country: d.country,
    updatedAt: d.updatedAt.toISOString(),
    keywords: parseListKeywords(d.keywords).map((k) => ({
      keyword: k.keyword,
      volume: k.volume,
      difficulty: k.difficulty,
      cpc: k.cpc,
      competition: k.competition,
      intent: k.intent,
      opportunity: k.opportunity,
      trend: [],
      results: 0,
    })),
  }));
}

export default async function ListsPage() {
  const [lists, project] = await Promise.all([getLists(), getActiveProject()]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="My Lists"
        description={
          project
            ? `Saved keywords for ${project.name}`
            : "Create a project to save keyword lists."
        }
      />

      <ListsView lists={lists} />
    </div>
  );
}
