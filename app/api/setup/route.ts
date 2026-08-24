import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { getSetupSnapshot, SNOOZE_COOKIE, SNOOZE_MS } from "@/lib/setup/state";

const muteSchema = z.object({
  projectId: z.string().min(1),
  muted: z.boolean(),
});

async function owned(userId: string, projectId: string) {
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
  if (!(await owned(session.userId, projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const snapshot = await getSetupSnapshot(projectId);
  const snoozeUntil = (await cookies()).get(SNOOZE_COOKIE)?.value ?? "";
  const snoozed =
    snoozeUntil.startsWith(`${projectId}:`) &&
    Number(snoozeUntil.slice(projectId.length + 1)) > Date.now();

  return NextResponse.json({ snapshot, snoozed });
}

/** Remind Me Later — sets a 24h cookie. Does not mute forever. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const projectId =
    typeof body === "object" && body !== null && "projectId" in body
      ? String((body as { projectId?: unknown }).projectId ?? "")
      : "";

  if (!(await owned(session.userId, projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const until = Date.now() + SNOOZE_MS;
  const res = NextResponse.json({ ok: true, until });
  res.cookies.set(SNOOZE_COOKIE, `${projectId}:${String(until)}`, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SNOOZE_MS / 1000,
    path: "/",
  });
  return res;
}

/** Project-settings mute: hide reminders until the owner turns them back on. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = muteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (!(await owned(session.userId, parsed.data.projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await prisma.project.update({
    where: { id: parsed.data.projectId },
    data: { wpReminderMuted: parsed.data.muted },
  });

  return NextResponse.json({ ok: true, muted: parsed.data.muted });
}
