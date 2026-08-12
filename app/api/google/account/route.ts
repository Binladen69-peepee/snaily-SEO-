import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Disconnects the signed-in user's Google account.
 *
 * Only the stored tokens are removed. Each project keeps its Search Console
 * and Analytics selections, and the metrics already synced stay put, so
 * reconnecting the same account restores everything without re-picking.
 *
 * Revoking with Google is deliberately not attempted: the grant may be shared
 * with other tools the owner uses, and silently killing those would be a
 * surprise. Access is removed from this app; the Google-side grant is theirs
 * to revoke in their account settings.
 */
export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await prisma.googleAccount.deleteMany({
    where: { userId: session.userId },
  });

  return NextResponse.json({ ok: true, removed: deleted.count });
}
