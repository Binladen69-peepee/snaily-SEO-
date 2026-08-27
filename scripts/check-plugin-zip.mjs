/**
 * Proves the served .zip contains the connector version it claims to.
 *
 * The download route names the file from `PLUGIN_VERSION` and builds the
 * archive from the same module, so the two cannot disagree — but that is an
 * argument, not a check, and the thing that actually went wrong in production
 * was neither: the deployment was older than the source. So this opens the
 * archive, reads the plugin header out of the PHP inside it, and compares.
 *
 *   npm run check:plugin-zip                      # the local build
 *   npm run check:plugin-zip -- <url> <cookie>    # a deployed one
 */
import { inflateRawSync } from "node:zlib";

import { compile } from "./compile.mjs";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/**
 * Reads the files out of a zip.
 *
 * Only what this archive uses: stored and deflated entries, read from the
 * local file headers. A full zip reader would be a dependency to verify two
 * text files.
 */
function unzip(buffer) {
  const files = new Map();
  let i = 0;

  while (i + 4 <= buffer.length) {
    if (buffer.readUInt32LE(i) !== 0x04034b50) break;

    const method = buffer.readUInt16LE(i + 8);
    const compressed = buffer.readUInt32LE(i + 18);
    const uncompressed = buffer.readUInt32LE(i + 22);
    const nameLength = buffer.readUInt16LE(i + 26);
    const extraLength = buffer.readUInt16LE(i + 28);

    const name = buffer.subarray(i + 30, i + 30 + nameLength).toString("utf8");
    const start = i + 30 + nameLength + extraLength;
    const raw = buffer.subarray(start, start + compressed);

    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    i = start + compressed;
    void uncompressed;
  }

  return files;
}

function versionIn(php) {
  return /^\s*\*\s*Version:\s*(.+)$/m.exec(php)?.[1]?.trim() ?? "";
}

async function main() {
  const url = process.argv[2];
  const cookie = process.argv[3];

  const built = compile(["lib/wordpress/plugin.ts", "lib/wordpress/zip.ts"], {
    prefix: ".zipcheck-",
  });
  const { buildPluginZip, PLUGIN_VERSION, PLUGIN_SLUG } = await built.load(
    "lib/wordpress/plugin.ts",
  );

  console.log(`\nSource version: ${PLUGIN_VERSION}`);

  let zip;
  let label;

  if (url === undefined) {
    zip = Buffer.from(buildPluginZip());
    label = "locally built archive";
  } else {
    const res = await fetch(url, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
    if (res.status !== 200) {
      console.log(`\n  FAIL  ${url} answered ${res.status}`);
      built.cleanup();
      process.exit(1);
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    console.log(`Served as   : ${disposition}`);
    zip = Buffer.from(await res.arrayBuffer());
    label = url;

    check(
      disposition.includes(`${PLUGIN_SLUG}-${PLUGIN_VERSION}.zip`),
      "the filename advertises the current version",
      disposition.replace(/^attachment;\s*/, ""),
    );
  }

  console.log(`\nChecking ${label} (${zip.length} bytes)`);

  const files = unzip(zip);
  console.log(`  entries: ${[...files.keys()].join(", ")}`);

  const phpEntry = [...files.keys()].find((f) => f.endsWith(".php"));
  check(phpEntry !== undefined, "the archive contains the plugin PHP");
  if (phpEntry === undefined) {
    built.cleanup();
    process.exit(1);
  }

  const php = files.get(phpEntry).toString("utf8");
  const headerVersion = versionIn(php);

  check(
    headerVersion === PLUGIN_VERSION,
    "the PHP inside the zip is the current version",
    `header says ${headerVersion || "(none)"}, source is ${PLUGIN_VERSION}`,
  );
  check(
    php.includes(`define('SNAILY_SEO_VERSION', '${PLUGIN_VERSION}')`),
    "and reports that version at runtime",
  );

  /*
   * Version numbers are cheap to bump and prove nothing on their own. These
   * are the routines 1.4.0 exists for, so their absence means the archive is
   * old regardless of what its header claims.
   */
  console.log("\n  1.4.0 functionality present in the archive");
  for (const [needle, what] of [
    ["_yoast_wpseo_focuskw", "writes the Yoast focus keyphrase"],
    ["_yoast_wpseo_meta-robots-noindex", "writes the noindex switch"],
    ["_yoast_wpseo_meta-robots-nofollow", "writes the nofollow switch"],
    ["_yoast_wpseo_primary_category", "writes the primary category"],
    ["snaily_seo_create_recipe", "creates the WP Recipe Maker card"],
    ["snaily_seo_recipe_nutrition", "runs the nutrition analysis"],
    ["snaily_seo_recipe_summary", "reads the card back for verification"],
    ["'supports'", "reports what it supports to the app"],
  ]) {
    check(php.includes(needle), what);
  }

  /*
   * 1.5.0: the media alt route. This is the only route that can change
   * anything on a published site, so the archive is checked for both the
   * route and the guards that keep it narrow.
   */
  for (const [needle, what] of [
    ["snaily_seo_media_set_alt", "1.5.0: the media alt route is present"],
    ["post_type !== 'attachment'", "  and refuses anything that is not an attachment"],
    ["wp_attachment_is_image", "  and anything that is not an image"],
    ["'persisted' =>", "  and reads the value back so a caller can confirm it"],
  ]) {
    check(php.includes(needle), what);
  }

  const readme = [...files.keys()].find((f) => f.endsWith("readme.txt"));
  check(readme !== undefined, "the archive contains the readme");
  if (readme !== undefined) {
    check(
      files.get(readme).toString("utf8").includes(PLUGIN_VERSION),
      "the readme's stable tag matches",
    );
  }

  built.cleanup();
}

await main();

console.log(
  failures === 0 ? "\nThe archive is the current connector.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
