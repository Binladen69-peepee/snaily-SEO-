import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import type { Issue } from "@/lib/audit/types";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const SORTABLE = new Set([
  "url",
  "status",
  "title",
  "wordCount",
  "issueScore",
  "lastModified",
]);

function parseIssues(value: unknown): Issue[] {
  if (!Array.isArray(value)) return [];
  return value as Issue[];
}

export async function GET(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Ownership is checked on the audit, so pages can't be read cross-tenant.
  const audit = await prisma.audit.findFirst({
    where: { id, userId: session.userId },
  });
  if (!audit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const issue = url.searchParams.get("issue") ?? "";
  const sortField = url.searchParams.get("sort") ?? "issueScore";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const perPage = 50;

  const where: Prisma.AuditPageWhereInput = {
    auditId: id,
    ...(q !== ""
      ? {
          OR: [
            { url: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    // Denormalized issueCodes replaces Mongo `issues.code` path query.
    ...(issue !== "" ? { issueCodes: { has: issue } } : {}),
  };

  const orderBy: Prisma.AuditPageOrderByWithRelationInput = SORTABLE.has(
    sortField,
  )
    ? { [sortField]: dir }
    : { issueScore: "desc" };

  const [total, docs] = await Promise.all([
    prisma.auditPage.count({ where }),
    prisma.auditPage.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    perPage,
    pages: docs.map((p) => ({
      id: p.id,
      url: p.url,
      path: p.path,
      status: p.status,
      title: p.title,
      metaDescription: p.metaDescription,
      h1: p.h1,
      wordCount: p.wordCount,
      canonical: p.canonical,
      indexable: p.indexable,
      lastModified: p.lastModified?.toISOString() ?? null,
      imagesTotal: p.imagesTotal,
      imagesMissingAlt: p.imagesMissingAlt,
      internalLinkCount: p.internalLinkCount,
      brokenLinks: p.brokenLinks,
      issues: parseIssues(p.issues),
      issueScore: p.issueScore,
    })),
  });
}
