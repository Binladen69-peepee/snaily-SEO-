import { NextResponse } from "next/server";
import { z } from "zod";

import { runAudit } from "@/lib/audit/run";
import { expireStaleAudits } from "@/lib/audit/stale";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

const schema = z.object({
  projectId: z.string().min(1),
  maxPages: z.number().int().min(1).max(500).default(100),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (projectId === null || !isValidId(projectId)) {
    return NextResponse.json({ error: "Project required" }, { status: 400 });
  }

  const audits = await prisma.audit.findMany({
    where: { userId: session.userId, projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    audits: audits.map((a) => ({
      id: a.id,
      status: a.status,
      pagesCrawled: a.pagesCrawled,
      healthScore: a.healthScore,
      totalIssues: a.totalIssues,
      startedAt: a.startedAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      error: a.error ?? null,
    })),
  });
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

  const { projectId, maxPages } = parsed.data;
  if (!isValidId(projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.userId },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Clear crawls that died mid-run so they do not block a fresh audit.
  await expireStaleAudits(projectId);

  // Only one crawl per project at a time.
  const running = await prisma.audit.findFirst({
    where: { projectId, status: "running" },
  });
  if (running) {
    return NextResponse.json(
      {
        error: "An audit is already running for this project",
        id: running.id,
      },
      { status: 409 },
    );
  }

  const audit = await prisma.audit.create({
    data: {
      userId: session.userId,
      projectId,
      startUrl: project.url,
      maxPages,
      status: "running",
    },
  });

  // Fire and forget — the client polls for progress.
  void runAudit(audit.id, project.id, project.url, maxPages);

  return NextResponse.json({ id: audit.id }, { status: 201 });
}
