import {
  AffiliateLinksView,
  type AffiliateRow,
} from "@/components/affiliate-links-view";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Ingredient Links · Snaily SEO" };

export default async function IngredientLinksPage() {
  const [session, project] = await Promise.all([getSession(), getActiveProject()]);

  let links: AffiliateRow[] = [];
  if (session && project) {
    links = await prisma.affiliateLink.findMany({
      where: { projectId: project.id },
      orderBy: [{ enabled: "desc" }, { term: "asc" }],
      select: {
        id: true,
        term: true,
        category: true,
        url: true,
        kind: true,
        enabled: true,
      },
    });
  }

  return (
    <AffiliateLinksView
      projectId={project?.id ?? null}
      projectName={project?.name ?? null}
      initialLinks={links}
    />
  );
}
