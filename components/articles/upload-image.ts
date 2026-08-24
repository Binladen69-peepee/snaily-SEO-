"use client";

export type UploadedImage = {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
};

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

/**
 * Downscale on the client so the Drafter never stores a 8 MB camera original.
 * Aspect ratio is kept. Output is JPEG unless the source is a PNG with alpha.
 */
export async function prepareImageFile(file: File): Promise<{
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that image.");
  ctx.drawImage(img, 0, 0, width, height);

  const png = file.type === "image/png";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Could not encode that image."));
      },
      png ? "image/png" : "image/jpeg",
      png ? undefined : JPEG_QUALITY,
    );
  });

  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return {
    blob,
    filename: png ? `${base}.png` : `${base}.jpg`,
    width,
    height,
  };
}

export async function uploadArticleImage(
  articleId: string,
  file: File,
  alt = "",
): Promise<UploadedImage> {
  const prepared = await prepareImageFile(file);
  const body = new FormData();
  body.append(
    "file",
    new File([prepared.blob], prepared.filename, {
      type: prepared.blob.type,
    }),
  );
  body.append("alt", alt);
  body.append("width", String(prepared.width));
  body.append("height", String(prepared.height));

  const res = await fetch(`/api/articles/${articleId}/media`, {
    method: "POST",
    body,
  });
  const data = (await res.json()) as UploadedImage & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not upload that image.");
  }
  return data;
}
