import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import {
  findTemplateCandidates,
  resolveTemplate,
  SECTION_LABELS,
  TemplateNotFound,
} from "@/lib/wordpress/template";

/**
 * Which WordPress post the Drafter duplicates.
 *
 * The candidates come from posts already synced from the site, so the picker
 * shows real posts with real IDs and the author confirms rather than types one
 * in. Choosing one only records the ID — nothing is written to WordPress here.
 */

async function ownProject(projectId: string, userId: string) {
  if (!isValidId(projectId)) return null;
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, wpTemplatePostId: true },
  });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const project = await ownProject(projectId, session.userId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const candidates = await findTemplateCandidates(project.id);

  let active: {
    wpId: number;
    title: string;
    status: string;
    configured: boolean;
    sections: { key: string; label: string }[];
    unknownHeadings: string[];
  } | null = null;
  let error: string | null = null;

  try {
    const resolved = await resolveTemplate(project.id);
    active = {
      wpId: resolved.wpId,
      title: resolved.title,
      status: resolved.status,
      configured: resolved.configured,
      sections: resolved.structure.order
        .filter((key) => key !== "intro")
        .map((key) => ({ key, label: SECTION_LABELS[key] })),
      unknownHeadings: resolved.structure.unknownHeadings,
    };
  } catch (err) {
    error = err instanceof TemplateNotFound ? err.message : "Could not read the template.";
  }

  return NextResponse.json({
    configuredId: project.wpTemplatePostId,
    active,
    error,
    candidates: candidates.map((c) => ({
      wpId: c.wpId,
      title: c.title,
      status: c.status,
      matchedSections: c.matchedSections,
      sections: c.sections.map((key) => SECTION_LABELS[key]),
    })),
  });
}

const putSchema = z.object({
  projectId: z.string().min(1),
  /** WordPress post ID, or null to go back to auto-detection. */
  wpId: z.number().int().positive().nullable(),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const project = await ownProject(parsed.data.projectId, session.userId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (parsed.data.wpId !== null) {
    // Confirmed against the synced mirror rather than accepted on trust: an ID
    // that is not there would fail later, at export time, with nothing to say.
    const row = await prisma.wpPost.findUnique({
      where: { projectId_wpId: { projectId: project.id, wpId: parsed.data.wpId } },
      select: { content: true },
    });
    if (!row || row.content.trim() === "") {
      return NextResponse.json(
        {
          error:
            "That post is not in the synced content, or it is empty. Sync WordPress and try again.",
        },
        { status: 404 },
      );
    }
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { wpTemplatePostId: parsed.data.wpId },
  });

  return NextResponse.json({ ok: true, wpId: parsed.data.wpId });
}
