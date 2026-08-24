import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import {
  GENERIC_TERMS,
  normaliseTerm,
  parseAffiliateCsv,
} from "@/lib/content/affiliate";
import { isValidId, prisma } from "@/lib/db";

/**
 * The author's ingredient → URL spreadsheet.
 *
 * Imports replace the whole set for a project rather than merging: the sheet
 * is the source of truth, and a merge would leave rows behind that the author
 * had deleted from it with no way to tell.
 */

export const maxDuration = 60;

async function ownProject(projectId: string, userId: string) {
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
  const project = await ownProject(projectId, session.userId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const links = await prisma.affiliateLink.findMany({
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

  return NextResponse.json({
    links,
    counts: {
      total: links.length,
      enabled: links.filter((l) => l.enabled).length,
      affiliate: links.filter((l) => l.kind === "affiliate").length,
      internal: links.filter((l) => l.kind === "internal").length,
    },
  });
}

const importSchema = z.object({
  projectId: z.string().min(1),
  /** Raw CSV text. 5 MB is far beyond the real file's 70 KB. */
  csv: z.string().min(1).max(5_000_000),
});

export async function POST(req: Request) {
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

  const parsed = importSchema.safeParse(body);
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

  const siteHost = (() => {
    try {
      return new URL(project.url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  })();

  const { terms, skippedNoUrl, skippedBadUrl } = parseAffiliateCsv(
    parsed.data.csv,
    siteHost,
  );

  if (terms.length === 0) {
    return NextResponse.json(
      {
        error:
          "No rows with a usable URL. Expected columns: canonical_ingredient, category, affiliate_url.",
      },
      { status: 400 },
    );
  }

  /*
   * Terms the author had already switched off stay off. Re-importing the sheet
   * should not silently re-enable every generic they turned down.
   */
  const previous = await prisma.affiliateLink.findMany({
    where: { projectId: project.id, enabled: false },
    select: { term: true },
  });
  const previouslyDisabled = new Set(previous.map((p) => p.term));

  await prisma.affiliateLink.deleteMany({ where: { projectId: project.id } });

  const rows = terms.map((t) => ({
    projectId: project.id,
    term: t.term,
    words: t.words,
    category: t.category,
    url: t.url,
    kind: t.kind,
    enabled: !GENERIC_TERMS.has(t.term) && !previouslyDisabled.has(t.term),
  }));

  for (let i = 0; i < rows.length; i += 500) {
    await prisma.affiliateLink.createMany({
      data: rows.slice(i, i + 500),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    ok: true,
    imported: rows.length,
    enabled: rows.filter((r) => r.enabled).length,
    affiliate: rows.filter((r) => r.kind === "affiliate").length,
    internal: rows.filter((r) => r.kind === "internal").length,
    skippedNoUrl,
    skippedBadUrl,
    disabledGenerics: rows.filter((r) => !r.enabled).map((r) => r.term),
  });
}

const patchSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().optional(),
  url: z.string().url().max(2_000).optional(),
});

export async function PATCH(req: Request) {
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Ownership is checked through the project, so one user cannot toggle
  // another's rows by guessing an id.
  const link = await prisma.affiliateLink.findFirst({
    where: { id: parsed.data.id, project: { userId: session.userId } },
    select: { id: true },
  });
  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  await prisma.affiliateLink.update({
    where: { id: link.id },
    data: {
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      ...(parsed.data.url !== undefined ? { url: parsed.data.url } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

/** Used by the manager to add a single term without re-importing the sheet. */
const addSchema = z.object({
  projectId: z.string().min(1),
  term: z.string().trim().min(2).max(120),
  url: z.string().url().max(2_000),
  category: z.string().trim().max(60).default(""),
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

  const parsed = addSchema.safeParse(body);
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

  const siteHost = (() => {
    try {
      return new URL(project.url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  })();
  const host = (() => {
    try {
      return new URL(parsed.data.url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  })();

  const term = normaliseTerm(parsed.data.term);

  await prisma.affiliateLink.upsert({
    where: { projectId_term: { projectId: project.id, term } },
    create: {
      projectId: project.id,
      term,
      words: term.split(" ").length,
      category: parsed.data.category,
      url: parsed.data.url,
      kind: siteHost !== "" && host === siteHost ? "internal" : "affiliate",
      enabled: true,
    },
    update: { url: parsed.data.url, category: parsed.data.category, enabled: true },
  });

  return NextResponse.json({ ok: true });
}
