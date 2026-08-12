import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setActiveProject } from "@/lib/projects";
import { projectSchema } from "@/lib/validation";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = projectSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, url, description } = parsed.data;

  const existing = await prisma.project.findUnique({
    where: { userId_url: { userId: session.userId, url } },
  });

  if (existing) {
    return NextResponse.json(
      { error: "You already have a project for this website" },
      { status: 409 },
    );
  }

  const project = await prisma.project.create({
    data: {
      userId: session.userId,
      name,
      url,
      description: description || undefined,
    },
  });

  await setActiveProject(project.id);

  return NextResponse.json({ id: project.id }, { status: 201 });
}
