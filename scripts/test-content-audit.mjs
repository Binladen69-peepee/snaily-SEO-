/**
 * Content Intelligence audit regressions.
 *
 * Two client-reported false positives are pinned here, both with the negative
 * control that proves the check still fires on a real defect:
 *
 *   B. Images carrying `alt=""` were reported as missing alt text. That is the
 *      correct markup for a decorative image, and on cinnamonsnail.com every
 *      one of the 30 flagged images on /vegan-recipes was a Feast thumbnail
 *      inside a link that already had text.
 *
 *   C. A page the host answered with 429 was recorded as broken, so every link
 *      pointing at it was reported broken while opening fine in a browser.
 *
 *   npm run test:content-audit
 */
import * as cheerio from "cheerio";

import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const built = compile(
  [
    "lib/audit/images.ts",
    "lib/audit/link-status.ts",
    "lib/audit/checks.ts",
    "lib/audit/types.ts",
  ],
  { prefix: ".contentaudit-" },
);

const load = (html) => {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  return $;
};

try {
  const { auditImages, isDecorative, classifyImage } = await built.load(
    "lib/audit/images.ts",
  );
  const {
    classifyResponse,
    classifyFailure,
    shouldRetry,
    isBroken,
    normalizeForCompare,
  } = await built.load("lib/audit/link-status.ts");
  const { runChecks } = await built.load("lib/audit/checks.ts");
  const { isDefect } = await built.load("lib/audit/types.ts");

  /* ------------------------------------------------------------------ */
  console.log("\nB — an empty alt is correct markup, not a defect");

  // The exact shape the client's site produces.
  const feast = load(`<html><body><main><article><div class="entry-content">
    <ul class="feast-category-index-list">
      <li><a href="/sambal">Sambal Goreng<img class="feast-square-image" src="/x/Sambal-300x300.jpg" alt=""></a></li>
      <li><a href="/dal">Arhar Dal<img class="feast-square-image" src="/x/Dal-300x300.jpg" alt=""></a></li>
    </ul>
    <figure><img src="/x/hero.jpg" alt="Arhar dal with a spoon"></figure>
  </div></article></main></body></html>`);

  const feastAudit = auditImages(feast);
  check(
    feastAudit.missingAlt === 0,
    "a thumbnail with alt=\"\" is not reported as missing alt",
    `missingAlt=${feastAudit.missingAlt}`,
  );
  check(
    feastAudit.total === 1 && feastAudit.chrome === 2,
    "the category index is chrome; the hero is the one content image",
    `content=${feastAudit.total} chrome=${feastAudit.chrome}`,
  );

  // NEGATIVE CONTROL: the check must still fire on a genuine defect.
  const genuine = load(`<html><body><main><article><div class="entry-content">
    <figure><img src="/x/step-1.jpg"></figure>
    <figure><img src="/x/step-2.jpg" alt="Toasting the spices"></figure>
  </div></article></main></body></html>`);
  const genuineAudit = auditImages(genuine);
  check(
    genuineAudit.missingAlt === 1,
    "a content image with NO alt attribute is still reported",
    `missingAlt=${genuineAudit.missingAlt} of ${genuineAudit.total}`,
  );

  const decorativeCases = [
    ['<img src="a.jpg" alt="">', "empty alt"],
    ['<img src="a.jpg" role="presentation">', "role=presentation"],
    ['<img src="a.jpg" role="none">', "role=none"],
    ['<img src="a.jpg" aria-hidden="true">', "aria-hidden"],
    ['<img src="/img/spacer.gif">', "spacer asset"],
    ['<img src="/px/track?id=1">', "tracking asset"],
    ['<img src="a.gif" width="1" height="1">', "1x1 pixel"],
  ];
  for (const [html, label] of decorativeCases) {
    const $ = load(`<div class="entry-content">${html}</div>`);
    check(isDecorative($("img").first()), `decorative: ${label}`);
  }

  const meaningful = load(
    '<div class="entry-content"><img src="a.jpg" alt="A bowl of dal"></div>',
  );
  check(
    !isDecorative(meaningful("img").first()),
    "an image with real alt text is not decorative",
  );
  check(
    classifyImage(meaningful, meaningful("img").first()) === "content",
    "and it classifies as content",
  );

  // The Genesis layout wrapper that once excluded every image on the site.
  const genesis = load(`<html><body><div class="site-container"><div class="content-sidebar-wrap">
    <main class="content"><article><div class="entry-content">
      <img src="/a.jpg" alt="A plated dish">
      <img src="/b.jpg">
    </div></article></main></div></div></body></html>`);
  const genesisAudit = auditImages(genesis);
  check(
    genesisAudit.total === 2,
    "content-sidebar-wrap is a layout name, not a sidebar — images still count",
    `content=${genesisAudit.total} chrome=${genesisAudit.chrome}`,
  );
  check(
    genesisAudit.missingAlt === 1,
    "and the one genuinely missing alt inside it is found",
  );

  // Real chrome is still excluded.
  const chrome = load(`<html><body>
    <header><img src="/logo.png"></header>
    <nav><img src="/menu.png"></nav>
    <main><article><div class="entry-content"><img src="/hero.jpg" alt="Hero"></div></article></main>
    <footer><img src="/badge.png"></footer>
  </body></html>`);
  const chromeAudit = auditImages(chrome);
  check(
    chromeAudit.total === 1 && chromeAudit.missingAlt === 0,
    "header/nav/footer images are not part of the page's content",
    `content=${chromeAudit.total}`,
  );

  /* ------------------------------------------------------------------ */
  console.log("\nC — a blocked or redirected link is not a broken link");

  const outcomes = {
    ok: classifyResponse("https://a.com/p", 200, "https://a.com/p"),
    slash: classifyResponse("https://a.com/p", 200, "https://a.com/p/"),
    www: classifyResponse("https://www.a.com/p", 200, "https://a.com/p"),
    moved: classifyResponse("https://a.com/p", 200, "https://a.com/q"),
    threeOhOne: classifyResponse("https://a.com/p", 301, "https://a.com/p"),
    rate: classifyResponse("https://a.com/p", 429, "https://a.com/p"),
    forbidden: classifyResponse("https://a.com/p", 403, "https://a.com/p"),
    cf: classifyResponse("https://a.com/p", 521, "https://a.com/p"),
    gone: classifyResponse("https://a.com/p", 404, "https://a.com/p"),
    server: classifyResponse("https://a.com/p", 500, "https://a.com/p"),
    abort: classifyFailure(
      "https://a.com/p",
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    ),
  };

  check(outcomes.ok.state === "valid", "200 is valid");
  check(
    outcomes.slash.state === "valid",
    "a trailing-slash difference is not a redirect",
    outcomes.slash.state,
  );
  check(
    outcomes.www.state === "valid",
    "www -> apex is not a redirect worth reporting",
    outcomes.www.state,
  );
  check(outcomes.moved.state === "redirect", "a genuine new path is a redirect");
  check(outcomes.threeOhOne.state === "redirect", "an unfollowed 3xx is a redirect");
  check(
    outcomes.rate.state === "blocked",
    "429 is BLOCKED, not broken — the client's exact false positive",
    outcomes.rate.state,
  );
  check(outcomes.forbidden.state === "blocked", "403 is BLOCKED, not broken");
  check(outcomes.cf.state === "blocked", "a Cloudflare 5xx edge code is BLOCKED");
  check(outcomes.abort.state === "timeout", "an aborted request is TIMEOUT, not broken");

  check(outcomes.gone.state === "broken", "404 IS broken");
  check(outcomes.server.state === "broken", "500 IS broken");

  for (const [key, o] of Object.entries(outcomes)) {
    if (["gone", "server"].includes(key)) continue;
    check(!isBroken(o), `  ${key} never counts against the site`);
  }

  check(shouldRetry(outcomes.rate), "a rate-limited page is retried");
  check(shouldRetry(outcomes.abort), "a timed-out page is retried");
  check(!shouldRetry(outcomes.gone), "a 404 is not retried");

  check(
    normalizeForCompare("https://www.A.com/p/") === normalizeForCompare("http://a.com/p"),
    "protocol, www and trailing slash do not make two different URLs",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nThe issue list the author actually sees");

  const page = (over) => ({
    url: "https://a.com/p",
    status: 200,
    title: "A title that is a perfectly reasonable length",
    metaDescription: "A meta description of an entirely unremarkable length.",
    h1: ["One heading"],
    wordCount: 900,
    canonical: "",
    indexable: true,
    lastModified: null,
    imagesTotal: 10,
    imagesMissingAlt: 0,
    imagesDecorative: 0,
    imagesChrome: 0,
    internalLinks: [],
    brokenLinks: [],
    blockedLinks: [],
    outcome: outcomes.ok,
    issues: [],
    ...over,
  });
  const ctx = {
    duplicateTitles: new Set(),
    duplicateDescriptions: new Set(),
    minWordCount: 300,
  };
  const codes = (p) => runChecks(p, ctx).map((i) => i.code);

  check(
    !codes(page({ imagesDecorative: 30 })).includes("missing_alt"),
    "30 decorative images raise no missing-alt issue",
  );
  check(
    codes(page({ imagesDecorative: 30 })).includes("decorative_image"),
    "they are reported as correctly-marked decorative instead",
  );
  check(
    codes(page({ imagesMissingAlt: 2 })).includes("missing_alt"),
    "a real missing alt still raises the issue",
  );
  check(
    !codes(page({ blockedLinks: ["https://a.com/x"] })).includes("broken_internal_link"),
    "a blocked link raises no broken-link issue",
  );
  check(
    codes(page({ blockedLinks: ["https://a.com/x"] })).includes("blocked_internal_link"),
    "it is surfaced as unable-to-check instead",
  );
  check(
    codes(page({ brokenLinks: ["https://a.com/x"] })).includes("broken_internal_link"),
    "a genuinely broken link still raises the issue",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA page the host refused is not a page with errors");

  const blockedPage = page({ status: 429, outcome: outcomes.rate });
  const brokenPage = page({ status: 404, outcome: outcomes.gone });

  check(
    !codes(blockedPage).includes("http_error"),
    "a 429 raises no HTTP error — 59 of 100 pages in the client's last audit",
  );
  check(
    codes(blockedPage).includes("page_unreachable"),
    "it is reported as unreachable instead",
  );
  check(codes(brokenPage).includes("http_error"), "a real 404 IS an HTTP error");

  // The status-0 hole: a request that never completed passed `status < 400`,
  // so a page that was never read was reported as having no title and no H1.
  const unreachable = page({
    status: 0,
    outcome: outcomes.abort,
    title: "",
    h1: [],
    metaDescription: "",
    wordCount: 0,
  });
  const unreachableCodes = codes(unreachable);
  for (const code of [
    "missing_title",
    "missing_h1",
    "missing_meta_description",
    "short_content",
  ]) {
    check(
      !unreachableCodes.includes(code),
      `  a page that was never fetched is not accused of ${code}`,
    );
  }

  /* ------------------------------------------------------------------ */
  console.log("\nClean means nothing to fix, not nothing to say");

  check(!isDefect("decorative_image"), "correct decorative markup is not a defect");
  check(!isDefect("blocked_internal_link"), "an unreachable link target is not a defect");
  check(!isDefect("page_unreachable"), "a blocked crawl is not a defect");
  check(isDefect("missing_alt"), "a real missing alt IS a defect");
  check(isDefect("broken_internal_link"), "a real broken link IS a defect");
  check(isDefect("http_error"), "a real HTTP error IS a defect");

  const informationalOnly = page({ imagesDecorative: 12, blockedLinks: ["https://a.com/x"] });
  check(
    runChecks(informationalOnly, ctx).length > 0,
    "a page with only informational rows still reports them",
  );
  check(
    runChecks(informationalOnly, ctx).filter((i) => isDefect(i.code)).length === 0,
    "but counts as clean, because there is nothing to fix",
  );
} finally {
  built.cleanup();
}

console.log(
  failures === 0
    ? "\nAll Content Intelligence audit checks passed.\n"
    : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
