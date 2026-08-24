import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string; assetId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, assetId } = await params;
  if (!isValidId(id) || !isValidId(assetId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const asset = await prisma.articleAsset.findFirst({
    where: {
      id: assetId,
      articleId: id,
      article: { userId: session.userId },
    },
    select: { data: true, mime: true, filename: true },
  });

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mime || "image/jpeg",
      "Content-Disposition": `inline; filename="${asset.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, assetId } = await params;
  if (!isValidId(id) || !isValidId(assetId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const owned = await prisma.articleAsset.findFirst({
    where: { id: assetId, articleId: id, article: { userId: session.userId } },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json()) as { alt?: unknown; caption?: unknown };
  const data: { alt?: string; caption?: string } = {};
  if (typeof body.alt === "string") data.alt = body.alt.slice(0, 200);
  if (typeof body.caption === "string") data.caption = body.caption.slice(0, 400);

  await prisma.articleAsset.update({ where: { id: assetId }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, assetId } = await params;
  if (!isValidId(id) || !isValidId(assetId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const owned = await prisma.articleAsset.findFirst({
    where: { id: assetId, articleId: id, article: { userId: session.userId } },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.articleAsset.delete({ where: { id: assetId } });
  return NextResponse.json({ ok: true });
}
