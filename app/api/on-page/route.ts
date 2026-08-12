import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { analyzeUrl } from "@/lib/seo/analyze";
import { findCannibalization } from "@/lib/seo/cannibalization";
import { checkTechnicalSeo } from "@/lib/seo/technical";

const analyzeSchema = z.object({
  url: z.string().trim().url().max(2000),
});

async function ownedProject(userId: string, projectId: string) {
  if (!isValidId(projectId)) return null;
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, url: true },
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = analyzeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid URL" },
      { status: 400 },
    );
  }

  try {
    const result = await analyzeUrl(parsed.data.url);
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json(
      { error: "Could not analyze this URL." },
      { status: 502 },
    );
  }
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

  const [technical, cannibalization] = await Promise.all([
    checkTechnicalSeo(project.url),
    findCannibalization(session.userId, project.id),
  ]);

  return NextResponse.json({ technical, cannibalization });
}
