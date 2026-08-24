import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";

export const maxDuration = 30;

const MAX_BYTES = 2_500_000;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const article = await prisma.article.findFirst({
    where: { id, userId: session.userId },
    select: { id: true },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const assets = await prisma.articleAsset.findMany({
    where: { articleId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      mime: true,
      alt: true,
      caption: true,
      width: true,
      height: true,
      sizeSlug: true,
      wpMediaId: true,
      wpUrl: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    items: assets.map((a) => ({
      ...a,
      url: `/api/articles/${id}/media/${a.id}`,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const article = await prisma.article.findFirst({
    where: { id, userId: session.userId },
    select: { id: true },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Use a JPEG, PNG, WebP or GIF." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Images must be under 2.5 MB after resize." },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const alt = String(form.get("alt") ?? "").slice(0, 200);
  const caption = String(form.get("caption") ?? "").slice(0, 400);
  const width = Number(form.get("width") ?? 0) || 0;
  const height = Number(form.get("height") ?? 0) || 0;
  const sizeSlug = ["small", "medium", "large", "full"].includes(
    String(form.get("sizeSlug") ?? ""),
  )
    ? String(form.get("sizeSlug"))
    : "large";

  const asset = await prisma.articleAsset.create({
    data: {
      articleId: id,
      filename: file.name.slice(0, 180) || "image.jpg",
      mime: file.type,
      data: buf,
      alt,
      caption,
      width,
      height,
      sizeSlug,
    },
    select: {
      id: true,
      filename: true,
      mime: true,
      alt: true,
      caption: true,
      width: true,
      height: true,
      sizeSlug: true,
    },
  });

  return NextResponse.json({
    ...asset,
    url: `/api/articles/${id}/media/${asset.id}`,
  });
}
