import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const audit = await prisma.audit.findFirst({
    where: { id, userId: session.userId },
  });

  if (!audit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: audit.id,
    status: audit.status,
    pagesCrawled: audit.pagesCrawled,
    pagesFound: audit.pagesFound,
    maxPages: audit.maxPages,
    healthScore: audit.healthScore,
    issueCounts: audit.issueCounts,
    totalIssues: audit.totalIssues,
    error: audit.error ?? null,
    startedAt: audit.startedAt.toISOString(),
    finishedAt: audit.finishedAt?.toISOString() ?? null,
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Cascade deletes AuditPage rows via the Prisma relation.
  const deleted = await prisma.audit.deleteMany({
    where: { id, userId: session.userId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
