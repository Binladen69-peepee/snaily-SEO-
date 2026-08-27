/**
 * Content Intelligence fix actions.
 *
 * Only one issue type can be fixed by machine, and only halfway: the author
 * writes the alt text, and this puts it on the right image. Everything that
 * could go wrong in that last step is here, because the failure modes are all
 * quiet ones — writing to the wrong image, writing twice, or reporting success
 * for a write that never landed.
 *
 *   npm run test:fix-actions
 */
import { readFileSync } from "node:fs";

import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const built = compile(["lib/audit/fix-alt.ts", "lib/audit/images.ts"], {
  prefix: ".fixactions-",
});

const SITE = "https://cinnamonsnail.com";

/** A connector that records what it was asked to do. */
function fakeConnector({ persisted = true, before = "", throws = null } = {}) {
  const calls = [];
  return {
    calls,
    async setMediaAlt(siteUrl, token, mediaId, alt) {
      calls.push({ mediaId, alt });
      if (throws !== null) throw throws;
      return {
        id: mediaId,
        url: `${SITE}/wp-content/uploads/hero.jpg`,
        before,
        alt: persisted ? alt : before,
        persisted,
        unchanged: before === alt,
      };
    },
  };
}

try {
  const { mediaKey, matchMedia, belongsToSite, applyAltFix } = await built.load(
    "lib/audit/fix-alt.ts",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nResolving an image URL to a media item");

  check(
    mediaKey(`${SITE}/wp-content/uploads/2024/02/hero-2-1024x683.jpg`) === "hero-2",
    "a generated size suffix is stripped",
    mediaKey(`${SITE}/wp-content/uploads/2024/02/hero-2-1024x683.jpg`),
  );
  check(
    mediaKey(`${SITE}/wp-content/uploads/hero-2-scaled.jpg`) === "hero-2",
    "and so is -scaled",
  );
  check(
    mediaKey("/wp-content/uploads/Step-3.JPEG") === "step-3",
    "matching ignores case and extension",
  );
  check(
    mediaKey(`${SITE}/a/hero.jpg`) === mediaKey("https://cdn.example.com/b/hero.jpg"),
    "the host and path do not affect the key, only the filename",
  );

  const library = [
    { id: 11, url: `${SITE}/wp-content/uploads/hero-2.jpg`, alt: "", title: "", thumb: "", width: 0, height: 0 },
    { id: 12, url: `${SITE}/wp-content/uploads/step-3.jpg`, alt: "", title: "", thumb: "", width: 0, height: 0 },
  ];

  check(
    matchMedia(`${SITE}/wp-content/uploads/hero-2-300x200.jpg`, library)?.id === 11,
    "a resized reference resolves to its original media item",
  );
  check(
    matchMedia(`${SITE}/wp-content/uploads/nothing-here.jpg`, library) === null,
    "an unknown image resolves to nothing rather than to the first match",
  );

  // Ambiguity must stop a fix, not pick one.
  const ambiguous = [
    ...library,
    { id: 13, url: `${SITE}/wp-content/uploads/2023/hero-2.jpg`, alt: "", title: "", thumb: "", width: 0, height: 0 },
  ];
  check(
    matchMedia(`${SITE}/wp-content/uploads/hero-2.jpg`, ambiguous) === null,
    "two media items with the same filename resolve to nothing",
  );

  check(belongsToSite(`${SITE}/a.jpg`, SITE), "a same-host image belongs to the site");
  check(
    belongsToSite("https://www.cinnamonsnail.com/a.jpg", SITE),
    "www and apex are the same site",
  );
  check(
    !belongsToSite("https://images.example.com/a.jpg", SITE),
    "an image on another host does not",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nThe fix itself");

  const ok = await applyAltFix({
    siteUrl: SITE,
    token: "t",
    src: `${SITE}/wp-content/uploads/hero-2-1024x683.jpg`,
    alt: "Arhar dal with a spoon",
    media: library,
    setMediaAltImpl: fakeConnector().setMediaAlt,
  });
  check(ok.state === "fixed", "a good fix reports fixed", ok.state);
  check(ok.mediaId === 11, "and names the media item it wrote to", String(ok.mediaId));

  /* --- idempotency: the same alt twice --- */
  const twice = await applyAltFix({
    siteUrl: SITE,
    token: "t",
    src: `${SITE}/wp-content/uploads/hero-2.jpg`,
    alt: "Already set",
    media: library,
    setMediaAltImpl: fakeConnector({ before: "Already set" }).setMediaAlt,
  });
  check(
    twice.state === "already",
    "writing the same alt again reports already, not a second edit",
    twice.state,
  );

  /* --- a write that did not persist --- */
  const ghost = await applyAltFix({
    siteUrl: SITE,
    token: "t",
    src: `${SITE}/wp-content/uploads/hero-2.jpg`,
    alt: "New text",
    media: library,
    setMediaAltImpl: fakeConnector({ persisted: false }).setMediaAlt,
  });
  check(
    ghost.state === "failed",
    "a 200 that did not store the value is a failure, not a success",
    ghost.state,
  );

  /* --- an old connector --- */
  const old = await applyAltFix({
    siteUrl: SITE,
    token: "t",
    src: `${SITE}/wp-content/uploads/hero-2.jpg`,
    alt: "New text",
    media: library,
    setMediaAltImpl: fakeConnector({
      throws: Object.assign(new Error("no route"), { kind: "route_missing" }),
    }).setMediaAlt,
  });
  check(
    old.state === "failed" && /1\.5\.0/.test(old.message),
    "an older connector is reported as needing an update, not as a broken fix",
    old.message,
  );

  /* --- refusals --- */
  const foreign = await applyAltFix({
    siteUrl: SITE,
    token: "t",
    src: "https://images.example.com/a.jpg",
    alt: "x",
    media: library,
    setMediaAltImpl: fakeConnector().setMediaAlt,
  });
  check(
    foreign.state === "manual_review",
    "an image on another host is manual review, not a failed write",
    foreign.state,
  );

  const unknown = await applyAltFix({
    siteUrl: SITE,
    token: "t",
    src: `${SITE}/wp-content/uploads/mystery.jpg`,
    alt: "x",
    media: library,
    setMediaAltImpl: fakeConnector().setMediaAlt,
  });
  check(
    unknown.state === "manual_review",
    "an unresolvable image is manual review",
    unknown.state,
  );

  const blank = await applyAltFix({
    siteUrl: SITE,
    token: "t",
    src: `${SITE}/wp-content/uploads/hero-2.jpg`,
    alt: "   ",
    media: library,
    setMediaAltImpl: fakeConnector().setMediaAlt,
  });
  check(blank.state === "failed", "empty alt is refused before any request");

  const connector = fakeConnector();
  await applyAltFix({
    siteUrl: SITE,
    token: "t",
    src: "https://images.example.com/a.jpg",
    alt: "x",
    media: library,
    setMediaAltImpl: connector.setMediaAlt,
  });
  check(
    connector.calls.length === 0,
    "a refused fix never reaches WordPress at all",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nThe audit records which images to fix");

  const { auditImages } = await built.load("lib/audit/images.ts");
  const cheerio = await import("cheerio");
  const $ = cheerio.load(`<main><article><div class="entry-content">
    <img src="/wp-content/uploads/step-1.jpg">
    <img src="/wp-content/uploads/step-2.jpg" alt="Toasting spices">
    <img src="/wp-content/uploads/step-3.jpg">
  </div></article></main>`);
  const audit = auditImages($);
  check(audit.missingAlt === 2, "two images are missing alt", String(audit.missingAlt));
  check(
    audit.missingAltSrc.length === 2 &&
      audit.missingAltSrc.includes("/wp-content/uploads/step-1.jpg"),
    "and both are named, so a fix has a target",
    audit.missingAltSrc.join(", "),
  );
  check(
    !audit.missingAltSrc.includes("/wp-content/uploads/step-2.jpg"),
    "the image that has alt text is not listed",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nThe route's authorisation chain");

  const route = readFileSync("app/api/content/fix-alt/route.ts", "utf8");
  check(/project: \{ userId: session\.userId \}/.test(route), "the page must belong to the caller's project");
  check(/auditId,/.test(route) && /url: pageUrl,/.test(route), "and to the named audit and page");
  check(
    /if \(!page\.imagesMissingAltSrc\.includes\(src\)\)/.test(route),
    "only an image this audit flagged can be written to",
  );
  check(
    /imagesMissingAlt: remaining\.length/.test(route),
    "the stored count moves with the list, so the dashboard cannot drift",
  );
  check(/max\(500\)/.test(route.replace(/\s/g, "")) || /max\(500\)/.test(route), "alt length is bounded at the edge");

  /* ------------------------------------------------------------------ */
  console.log("\nThe connector's write is as narrow as claimed");

  const plugin = readFileSync("lib/wordpress/plugin.ts", "utf8");
  check(
    /post_type !== 'attachment'/.test(plugin),
    "the alt route refuses anything that is not an attachment",
  );
  check(
    /wp_attachment_is_image\(\$id\)/.test(plugin),
    "and anything that is not an image",
  );
  check(
    /'persisted' => \$after === \$alt/.test(plugin),
    "it reads the value back and reports whether it persisted",
  );
  check(
    /snaily_seo_media_set_alt/.test(plugin) &&
      !/snaily_seo_media_set_alt[\s\S]{0,1200}post_content/.test(plugin),
    "the handler never touches post content",
  );
  check(
    /PLUGIN_VERSION = "1\.5\.0"/.test(plugin),
    "the connector version is bumped so old installs are detected",
  );
} finally {
  built.cleanup();
}

console.log(
  failures === 0 ? "\nAll fix-action checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
