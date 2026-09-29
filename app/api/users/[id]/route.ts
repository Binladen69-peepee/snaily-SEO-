import { NextResponse } from "next/server";
import { z } from "zod";

import { bumpSessionVersion, createSession, getSession, hashPassword } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { isOwner } from "@/lib/users";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(200).optional(),
    role: z.enum(["owner", "member"]).optional(),
    /** Owner-set replacement password. Blank means "leave it alone". */
    password: z.string().min(8).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

/**
 * Owner-only: update a teammate's credentials or access level.
 *
 * The owner needs to be able to fix a wrong email, reset a forgotten password
 * and grant or revoke access without touching the database by hand.
 */
export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isOwner(session.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body: unknown = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { password, ...fields } = parsed.data;

  // Demoting the last owner would lock everyone out of user management.
  if (
    fields.role === "member" &&
    target.role === "owner" &&
    (await prisma.user.count({ where: { role: "owner" } })) <= 1
  ) {
    return NextResponse.json(
      { error: "Cannot demote the last owner" },
      { status: 400 },
    );
  }

  // hashPassword is async (bcrypt), so it has to be resolved before the write.
  const passwordHash = password ? await hashPassword(password) : undefined;

  try {
    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...fields,
        ...(fields.email ? { email: fields.email.toLowerCase() } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: { id: true, name: true, email: true, role: true },
    });
    if (passwordHash) {
      await bumpSessionVersion(id);
      if (session.userId === id) {
        await createSession({
          userId: updated.id,
          email: updated.email,
          name: updated.name,
        });
      }
    }
    return NextResponse.json({ ok: true, user: updated });
  } catch {
    // The only realistic failure is the unique email constraint.
    return NextResponse.json(
      { error: "That email is already in use" },
      { status: 409 },
    );
  }
}

/** Owner-only: remove a teammate account. The owner cannot delete themselves. */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isOwner(session.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (id === session.userId) {
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Never leave the tool without an owner.
  if (target.role === "owner") {
    const owners = await prisma.user.count({ where: { role: "owner" } });
    if (owners <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last owner" },
        { status: 400 },
      );
    }
  }

  // Projects, audits and lists cascade with the user.
  await prisma.user.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
