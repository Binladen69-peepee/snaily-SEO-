import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getHistory } from "@/lib/keywords/history";
import { isValidId, prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ history: await getHistory() });
}

/** Deletes one entry with `?id=`, or the whole history without it. */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");

  if (id !== null) {
    if (!isValidId(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const deleted = await prisma.searchHistory.deleteMany({
      where: { id, userId: session.userId },
    });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } else {
    await prisma.searchHistory.deleteMany({ where: { userId: session.userId } });
  }

  return NextResponse.json({ ok: true });
}
