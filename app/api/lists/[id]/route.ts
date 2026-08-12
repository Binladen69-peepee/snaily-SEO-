import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { parseListKeywords } from "@/lib/keywords/list-types";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // `?keyword=` removes one keyword; without it the whole list is deleted.
  const keyword = new URL(req.url).searchParams.get("keyword");

  if (keyword !== null) {
    const list = await prisma.keywordList.findFirst({
      where: { id, userId: session.userId },
    });
    if (!list) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const next = parseListKeywords(list.keywords).filter(
      (k) => k.keyword !== keyword,
    );

    await prisma.keywordList.update({
      where: { id: list.id },
      data: { keywords: next },
    });

    return NextResponse.json({ ok: true, count: next.length });
  }

  const deleted = await prisma.keywordList.deleteMany({
    where: { id, userId: session.userId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
