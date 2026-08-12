import { NextResponse } from "next/server";

import { auditPagesToCsv } from "@/lib/audit/csv";
import type { Issue } from "@/lib/audit/types";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

function parseIssues(value: unknown): Issue[] {
  if (!Array.isArray(value)) return [];
  return value as Issue[];
}

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
    where: { id, userId: session.userId, status: "completed" },
    select: { id: true, startUrl: true },
  });
  if (!audit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pages = await prisma.auditPage.findMany({
    where: { auditId: id },
    orderBy: { issueScore: "desc" },
    select: {
      path: true,
      url: true,
      status: true,
      title: true,
      wordCount: true,
      issues: true,
    },
  });

  const csv = auditPagesToCsv(
    pages.map((p) => ({
      path: p.path,
      url: p.url,
      status: p.status,
      title: p.title,
      wordCount: p.wordCount,
      issues: parseIssues(p.issues),
    })),
  );

  let host = "site";
  try {
    host = new URL(audit.startUrl).hostname.replace(/^www\./, "");
  } catch {
    /* keep default */
  }

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${host}-audit.csv"`,
    },
  });
}
