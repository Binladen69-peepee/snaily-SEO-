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
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <PageHeader
          title="GEO Lab"
          description="AI Search Visibility Command Center — supporting articles that answer a real moment."
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

  const [row, ideas, gscRow] = await Promise.all([
    prisma.businessFacts.findUnique({ where: { projectId: project.id } }),
    prisma.geoIdea.findMany({
      where: { projectId: project.id, userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.project.findUnique({
      where: { id: project.id },
      select: { gscSiteUrl: true },
    }),
  ]);

  const anchorPages = row
    ? parseAnchorPages(row.anchorPages)
    : DEFAULT_ANCHOR_PAGES;

  const gscConnected =
    typeof gscRow?.gscSiteUrl === "string" && gscRow.gscSiteUrl.trim() !== "";

  return (
    <GeoLabView
      projectId={project.id}
      projectName={project.name}
      gscConnected={gscConnected}
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
