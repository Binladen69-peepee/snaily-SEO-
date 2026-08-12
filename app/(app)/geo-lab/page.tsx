import { Sparkles } from "lucide-react";
import Link from "next/link";

import { GeoLabView } from "@/components/geo/geo-lab-view";
import { PageHeader, ToolPrompt } from "@/components/tool-shell";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_ANCHOR_PAGES, parseAnchorPages } from "@/lib/geo/config";
import { serializeIdea } from "@/lib/geo/idea";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "GEO Lab · Snaily SEO" };

export default async function GeoLabPage() {
  const [session, project] = await Promise.all([
    getSession(),
    getActiveProject(),
  ]);

  if (!session || !project) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeader
          title="GEO Lab"
          description="Supporting articles that answer a real moment — the kind of specific content AI assistants actually cite."
        />
        <ToolPrompt icon={Sparkles} title="Create a project first">
          GEO Lab works against one site at a time.{" "}
          <Link href="/projects" className="text-primary hover:underline">
            Add your site
          </Link>{" "}
          to begin.
        </ToolPrompt>
      </div>
    );
  }

  const [row, ideas] = await Promise.all([
    prisma.businessFacts.findUnique({ where: { projectId: project.id } }),
    prisma.geoIdea.findMany({
      where: { projectId: project.id, userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const anchorPages = row
    ? parseAnchorPages(row.anchorPages)
    : DEFAULT_ANCHOR_PAGES;

  return (
    <GeoLabView
      projectId={project.id}
      anchorPages={anchorPages}
      initialFacts={{
        serviceArea: row?.serviceArea ?? "",
        travelPolicy: row?.travelPolicy ?? "",
        eventTypes: row?.eventTypes ?? "",
        guestMin: row?.guestMin ?? null,
        guestMax: row?.guestMax ?? null,
        dietaryHandling: row?.dietaryHandling ?? "",
        pricingLogic: row?.pricingLogic ?? "",
        leadTime: row?.leadTime ?? "",
        consultingScope: row?.consultingScope ?? "",
        pastEvents: row?.pastEvents ?? [],
        neverClaim: row?.neverClaim ?? [],
        anchorPages,
      }}
      initialIdeas={ideas.map(serializeIdea)}
    />
  );
}
