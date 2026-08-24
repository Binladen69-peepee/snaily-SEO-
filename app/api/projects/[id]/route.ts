import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { projectSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

const setupSchema = z.object({ onboarded: z.literal(true) });

/**
 * Marks the setup wizard finished.
 *
 * Separate from PATCH because PATCH takes the full project form; this is a
 * one-field state change the wizard makes on its last step.
 */
export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body: unknown = await req.json();
  if (!setupSchema.safeParse(body).success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.project.updateMany({
    where: { id, userId: session.userId },
    data: { onboardedAt: new Date() },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const clash = await prisma.project.findFirst({
    where: {
      userId: session.userId,
      url,
      NOT: { id },
    },
  });

  if (clash) {
    return NextResponse.json(
      { error: "You already have a project for this website" },
      { status: 409 },
    );
  }

  // Scoped by userId so one user can never edit another's project.
  const updated = await prisma.project.updateMany({
    where: { id, userId: session.userId },
    data: { name, url, description: description || null },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
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

  const deleted = await prisma.project.deleteMany({
    where: { id, userId: session.userId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
