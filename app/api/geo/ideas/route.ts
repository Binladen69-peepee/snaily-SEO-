import { NextResponse } from "next/server";
import { z } from "zod";

import { AiError } from "@/lib/ai";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { parseAnchorPages, type AnchorPage } from "@/lib/geo/config";
import { mapMoments, type BusinessFactsInput } from "@/lib/geo/generate";
import { serializeIdea } from "@/lib/geo/idea";
import { fetchExistingPosts } from "@/lib/geo/redundancy";
import { gatherSignals } from "@/lib/geo/signals";

/** Signal gathering, a redundancy crawl and one model pass. */
export const maxDuration = 60;

const schema = z.object({
  projectId: z.string().min(1),
  seed: z.string().trim().min(3).max(200),
  anchorPageId: z.string().min(1).max(60),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!isValidId(projectId)) {
    return NextResponse.json({ ideas: [] });
  }

  const ideas = await prisma.geoIdea.findMany({
    where: { projectId, userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  return NextResponse.json({ ideas: ideas.map(serializeIdea) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { projectId, seed, anchorPageId } = parsed.data;
  if (!isValidId(projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.userId },
    select: { id: true, url: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const factsRow = await prisma.businessFacts.findUnique({
    where: { projectId },
  });

  // The spec makes Business Facts the foundation — without it the drafting
  // step has nothing to ground against and would invent specifics.
  if (!factsRow || factsRow.serviceArea.trim() === "") {
    return NextResponse.json(
      {
        error:
          "Fill in Business Facts first — at minimum the service area. Ideas are grounded in those facts, not guessed.",
        needsFacts: true,
      },
      { status: 409 },
    );
  }

  const anchorPages = parseAnchorPages(factsRow.anchorPages);
  const anchor: AnchorPage =
    anchorPages.find((a) => a.id === anchorPageId) ?? anchorPages[0]!;

  const facts: BusinessFactsInput = {
    serviceArea: factsRow.serviceArea,
    travelPolicy: factsRow.travelPolicy,
    eventTypes: factsRow.eventTypes,
    guestMin: factsRow.guestMin,
    guestMax: factsRow.guestMax,
    dietaryHandling: factsRow.dietaryHandling,
    pricingLogic: factsRow.pricingLogic,
    leadTime: factsRow.leadTime,
    consultingScope: factsRow.consultingScope,
    pastEvents: factsRow.pastEvents,
    neverClaim: factsRow.neverClaim,
  };

  try {
    const [signals, published] = await Promise.all([
      gatherSignals(projectId, seed),
      fetchExistingPosts(project.url).catch(() => []),
    ]);

    const ideas = await mapMoments({
      seed,
      anchor,
      facts,
      signals: signals.signals,
      published,
    });

    if (ideas.length === 0) {
      return NextResponse.json(
        { error: "No usable ideas came back. Try a more specific seed topic." },
        { status: 502 },
      );
    }

    await prisma.geoIdea.createMany({
      data: ideas.map((i) => ({
        userId: session.userId,
        projectId,
        seed,
        anchorPageId: anchor.id,
        title: i.title,
        moment: i.moment,
        category: i.category,
        rationale: i.rationale,
        attributes: i.attributes,
        linkUrl: anchor.url,
        anchorText: i.anchorText,
        redundantWith: i.redundantWith,
      })),
    });

    const saved = await prisma.geoIdea.findMany({
      where: { projectId, userId: session.userId, seed },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      ideas: saved.map(serializeIdea),
      // The screen names the provider, so it has to be told which one answered.
      signals: { ...signals.counts, provider: signals.provider, cached: signals.cached },
      publishedChecked: published.length,
    });
  } catch (err) {
    console.error("[geo/ideas]", err);
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.configurable ? 503 : 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not map moments right now.",
      },
      { status: 502 },
    );
  }
}
