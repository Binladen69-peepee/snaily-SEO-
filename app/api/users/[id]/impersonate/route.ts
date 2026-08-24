import { NextResponse } from "next/server";

import { createSession, getSession, isImpersonating } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { isOwner } from "@/lib/users";

/**
 * Sign in as another account.
 *
 * The owner can already reset anyone's password, so this grants no access they
 * lacked — but a reset locks the real user out and leaves nothing behind.
 * Impersonation is reversible, time-boxed, visible on screen the whole time,
 * and recorded.
 */

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /*
   * Chaining is refused. Hopping owner → A → B would leave the log saying A
   * started the second session, which quietly launders who actually did it.
   * Return to your own account first.
   */
  if (isImpersonating(session)) {
    return NextResponse.json(
      { error: "Return to your own account before signing in as someone else." },
      { status: 409 },
    );
  }

  if (!(await isOwner(session.userId))) {
    return NextResponse.json({ error: "Owners only" }, { status: 403 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (id === session.userId) {
    return NextResponse.json(
      { error: "You are already signed in as yourself." },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await prisma.impersonationLog.create({
    data: {
      actorId: session.userId,
      actorEmail: session.email,
      targetId: target.id,
      targetEmail: target.email,
    },
  });

  await createSession({
    userId: target.id,
    email: target.email,
    name: target.name,
    impersonatorId: session.userId,
    impersonatorName: session.name,
    impersonatorEmail: session.email,
  });

  return NextResponse.json({ ok: true, name: target.name, email: target.email });
}
