import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { normalizeUrl } from "@/lib/validation";
import { WordPressError } from "@/lib/wordpress/client";
import { connectSite, disconnectSite, getStatus } from "@/lib/wordpress/sync";

const schema = z.object({
  projectId: z.string().min(1),
  /** Pasted from the plugin's settings screen. */
  token: z.string().min(10, "That token looks too short").max(200),
  /** Defaults to the project's own URL when omitted. */
  siteUrl: z.string().max(500).optional(),
});

/** Confirms the caller owns the project. */
async function ownedProject(userId: string, projectId: string) {
  if (!isValidId(projectId)) return null;
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, url: true },
  });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const project = await ownedProject(session.userId, projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ status: await getStatus(project.id) });
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

  const project = await ownedProject(session.userId, parsed.data.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const siteUrl = normalizeUrl(parsed.data.siteUrl ?? project.url);
  if (siteUrl === null) {
    return NextResponse.json(
      { error: "This project has no valid website URL" },
      { status: 400 },
    );
  }

  try {
    const info = await connectSite(project.id, siteUrl, parsed.data.token.trim());
    return NextResponse.json({ site: info, status: await getStatus(project.id) });
  } catch (err) {
    if (err instanceof WordPressError) {
      return NextResponse.json(
        { error: err.message, tokenProblem: err.tokenProblem },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Could not connect the site" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const project = await ownedProject(session.userId, projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await disconnectSite(project.id);
  return NextResponse.json({ ok: true });
}
