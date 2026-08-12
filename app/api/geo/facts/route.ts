import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { DEFAULT_ANCHOR_PAGES, parseAnchorPages } from "@/lib/geo/config";

const anchorSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  url: z.string().max(500).default(""),
});

const schema = z.object({
  projectId: z.string().min(1),
  serviceArea: z.string().max(2000).optional(),
  travelPolicy: z.string().max(2000).optional(),
  eventTypes: z.string().max(2000).optional(),
  guestMin: z.number().int().min(0).max(100000).nullable().optional(),
  guestMax: z.number().int().min(0).max(100000).nullable().optional(),
  dietaryHandling: z.string().max(2000).optional(),
  pricingLogic: z.string().max(2000).optional(),
  leadTime: z.string().max(2000).optional(),
  consultingScope: z.string().max(2000).optional(),
  pastEvents: z.array(z.string().max(400)).max(10).optional(),
  neverClaim: z.array(z.string().max(200)).max(20).optional(),
  anchorPages: z.array(anchorSchema).max(12).optional(),
});

async function ownedProject(userId: string, projectId: string) {
  if (!isValidId(projectId)) return null;
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!(await ownedProject(session.userId, projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const row = await prisma.businessFacts.findUnique({ where: { projectId } });

  return NextResponse.json({
    facts: row
      ? { ...row, anchorPages: parseAnchorPages(row.anchorPages) }
      : { projectId, anchorPages: DEFAULT_ANCHOR_PAGES },
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

  const { projectId, anchorPages, ...fields } = parsed.data;
  if (!(await ownedProject(session.userId, projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const data = {
    ...fields,
    ...(anchorPages ? { anchorPages } : {}),
  };

  const row = await prisma.businessFacts.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });

  return NextResponse.json({
    ok: true,
    facts: { ...row, anchorPages: parseAnchorPages(row.anchorPages) },
  });
}
