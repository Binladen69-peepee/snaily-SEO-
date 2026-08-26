/**
 * Raster favicons, generated from the one SVG so they cannot drift apart.
 *
 * `app/icon.svg` alone is not enough in practice. Browsers and crawlers still
 * request `/favicon.ico` directly — and ours was answering 404 — while iOS
 * wants a square PNG with a real background rather than a transparent one.
 * Both are produced here from `app/icon.svg`, so the tab icon, the bookmark
 * icon and the home-screen icon are the same snail by construction.
 *
 * sharp cannot write .ico, but an ICO file may embed PNGs directly (every
 * browser since IE11 reads that), so the container is assembled by hand.
 *
 *   npm run build:favicons
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const ROOT = process.cwd();
const SOURCE = join(ROOT, "app", "icon.svg");

/** Sizes inside favicon.ico. 48 is what Windows uses for large tiles. */
const ICO_SIZES = [16, 32, 48];
/** iOS home-screen icon. Apple ignores transparency and composites on black. */
const APPLE_SIZE = 180;

const svg = readFileSync(SOURCE);

/**
 * Render the SVG at one size.
 *
 * The snail is drawn in strokes on a transparent ground. At 16px a hairline
 * stroke disappears, so the source is rasterised at 4x and reduced — the
 * downsample thickens the line optically instead of dropping it.
 */
async function png(size, { background = null } = {}) {
  const scale = 4;
  const drawn = await sharp(svg, { density: 384 })
    .resize(size * scale, size * scale, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  let out = sharp(drawn).resize(size, size, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  if (background !== null) {
    out = out.flatten({ background });
  }

  return out.png({ compressionLevel: 9 }).toBuffer();
}

/** ICO container around already-encoded PNGs. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = [];
  let offset = 6 + images.length * 16;

  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    // 256 is written as 0 — the field is one byte.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    directory.push(entry);
    offset += data.length;
  }

  return Buffer.concat([
    header,
    ...directory,
    ...images.map((i) => i.data),
  ]);
}

const icoImages = [];
for (const size of ICO_SIZES) {
  icoImages.push({ size, data: await png(size) });
}

const ico = buildIco(icoImages);
writeFileSync(join(ROOT, "app", "favicon.ico"), ico);
console.log(`app/favicon.ico      ${ico.length} bytes (${ICO_SIZES.join(", ")}px)`);

// Apple composites transparency onto black, which would lose a blue outline.
const apple = await png(APPLE_SIZE, {
  background: { r: 255, g: 255, b: 255 },
});
writeFileSync(join(ROOT, "app", "apple-icon.png"), apple);
console.log(`app/apple-icon.png   ${apple.length} bytes (${APPLE_SIZE}px, white ground)`);
