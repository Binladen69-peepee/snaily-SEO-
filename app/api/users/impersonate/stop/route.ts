import { NextResponse } from "next/server";

import { createSession, getSession, isImpersonating } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isOwner } from "@/lib/users";

/**
 * Hand the session back to the operator who started it.
 *
 * The owner's identity is read from the signed token rather than from anything
 * the browser sends, so this cannot be used to become an account you were not
 * already acting on behalf of.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isImpersonating(session) || session.impersonatorId == null) {
    return NextResponse.json(
      { error: "This session is not impersonating anyone." },
      { status: 400 },
    );
  }

  const owner = await prisma.user.findUnique({
    where: { id: session.impersonatorId },
    select: { id: true, name: true, email: true },
  });

  /*
   * The operator must still exist and still be an owner. If they were demoted
   * or deleted while impersonating, restoring the token would hand back
   * privileges the account no longer has — so the session ends instead.
   */
  if (!owner || !(await isOwner(owner.id))) {
    return NextResponse.json(
      { error: "The original account is no longer an owner. Please sign in again." },
      { status: 403 },
    );
  }

  // Close the newest open row for this pairing; a stale open row means the tab
  // was simply closed, which is worth being able to see.
  const open = await prisma.impersonationLog.findFirst({
    where: { actorId: owner.id, targetId: session.userId, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (open) {
    await prisma.impersonationLog.update({
      where: { id: open.id },
      data: { endedAt: new Date() },
    });
  }

  await createSession({ userId: owner.id, email: owner.email, name: owner.name });

  return NextResponse.json({ ok: true, name: owner.name });
}
