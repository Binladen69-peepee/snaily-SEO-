/**
 * The spotlight cards, and what a false issue costs downstream.
 *
 * Two client reports meet in this file.
 *
 * The cards under "Fix these first" and "Highest opportunity" were reported as
 * not clickable. They were always buttons, and they always called focusPage,
 * which filtered the table to that page and expanded its row. What they never
 * did was take you there: the table sits a screenful below the cards, so the
 * detail opened outside the viewport and the click looked like it did nothing.
 *
 * And the pages on those cards were chosen partly by a defect they did not
 * have. Priority and opportunity are both sums over page.issues, so one false
 * missing-alt row does not merely add a line to a list — it decides which
 * pages appear on the cards at all.
 *
 *   npm run test:intelligence-cards
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const fs = await import("node:fs");
const view = fs.readFileSync(
  "components/intelligence/intelligence-view.tsx",
  "utf8",
);

/* ------------------------------------------------------------------ */
console.log("\nThe click flow, from card to detail");

check(
  /<button\s+type="button"\s+onClick=\{onOpen\}/.test(view),
  "a spotlight card is a real button with a handler, not a styled div",
);

// Both lists must go through the same mechanism, or they drift apart.
const opens = view.match(/onOpen=\{\(\) => \{\s*focusPage\(p\);\s*\}\}/g) ?? [];
check(
  opens.length === 2,
  "both card groups open through the one shared handler",
  `${String(opens.length)} call sites`,
);

const focusBody = /function focusPage\(page: PageIntel\) \{([\s\S]*?)\n  \}/.exec(
  view,
);
const fb = focusBody?.[1] ?? "";
check(/setQ\(page\.path\)/.test(fb), "focusPage filters the table to that page");
check(/setExpanded\(page\.url\)/.test(fb), "and expands that page's row");
check(/setPageNum\(1\)/.test(fb), "and returns to page 1, where the row now is");
check(
  /setFocusUrl\(page\.url\)/.test(fb),
  "and asks to be taken there — the part that was missing",
);

check(
  /data-page-row=\{p\.url\}/.test(view),
  "the expanded row is addressable, so the scroll can find it",
);
check(
  /scrollIntoView\(/.test(view) &&
    /useEffect\(\(\) => \{\s*if \(focusUrl === null\) return;/.test(view),
  "the scroll runs in an effect, after React has committed the new row",
);
check(
  /prefers-reduced-motion/.test(view),
  "and respects a reader who asked for no motion",
);
check(
  /\?\.focus\(\{ preventScroll: true \}\)/.test(view),
  "keyboard focus lands on the opened detail, not just the viewport",
);
check(
  /resultsRef/.test(view) && /row \?\? resultsRef\.current/.test(view),
  "a row that somehow is not rendered still scrolls to the results area",
);

// The card must not invent a destination: the detail is in the table.
check(
  !/<Link[^>]*href=[^>]*page\.path/.test(view),
  "a card does not navigate away to a guessed URL",
);

/* ------------------------------------------------------------------ */
console.log("\nWhat a false issue costs, once it is in the list");

const built = compile(["lib/audit/checks.ts", "lib/intelligence/score.ts"], {
  prefix: ".intelcards-",
});

try {
  const { runChecks } = await built.load("lib/audit/checks.ts");
  const { priorityScore, opportunityScore } = await built.load(
    "lib/intelligence/score.ts",
  );

  const ctx = {
    duplicateTitles: new Set(),
    duplicateDescriptions: new Set(),
    minWordCount: 300,
  };

  const crawled = (over) => ({
    url: "https://cinnamonsnail.com/vegan-taco-salad",
    status: 200,
    title: "Vegan Taco Salad",
    metaDescription: "A vegan taco salad.",
    h1: ["Vegan Taco Salad"],
    wordCount: 900,
    canonical: "https://cinnamonsnail.com/vegan-taco-salad",
    indexable: true,
    lastModified: null,
    imagesTotal: 19,
    imagesMissingAlt: 0,
    imagesMissingAltSrc: [],
    imagesDecorative: 0,
    imagesChrome: 4,
    internalLinks: [],
    brokenLinks: [],
    blockedLinks: [],
    outcome: {
      state: "valid",
      status: 200,
      finalUrl: "https://cinnamonsnail.com/vegan-taco-salad",
      redirected: false,
    },
    issues: [],
    ...over,
  });

  const snapshot = (page) => ({
    url: page.url,
    path: "/vegan-taco-salad",
    status: page.status,
    title: page.title,
    wordCount: page.wordCount,
    internalLinkCount: 12,
    brokenLinks: page.brokenLinks,
    imagesMissingAltSrc: page.imagesMissingAltSrc,
    lastModified: page.lastModified,
    issues: runChecks(page, ctx),
  });

  // The row the client's dashboard was actually reading: a pre-classifier
  // crawl of a page that, checked by hand and by the current classifier, has
  // 19 content images and none missing.
  const stalePage = crawled({ imagesMissingAlt: 19, imagesMissingAltSrc: [] });
  const stale = snapshot(stalePage);

  check(
    !stale.issues.some((i) => i.code === "missing_alt"),
    "the stale row raises no missing-alt issue",
  );
  check(
    priorityScore(stale, []).score === 0,
    "so it cannot put the page on Fix these first",
    `priority ${String(priorityScore(stale, []).score)}`,
  );
  check(
    opportunityScore(stale).score === 0,
    "nor on Highest opportunity",
    `opportunity ${String(opportunityScore(stale).score)}`,
  );

  // The same page with a genuine, sourced defect still scores.
  const realPage = crawled({
    imagesMissingAlt: 1,
    imagesMissingAltSrc: ["/wp-content/uploads/taco-salad.jpg"],
  });
  const real = snapshot(realPage);
  check(
    real.issues.some((i) => i.code === "missing_alt"),
    "a genuine defect is still an issue",
  );
  check(
    priorityScore(real, []).score > 0 && opportunityScore(real).score > 0,
    "and still scores on both cards — nothing was disabled to make this pass",
  );

  /*
   * Informational rows are shown, but never scored.
   *
   * The same crawl that cleared the missing-alt false positives was
   * rate-limited by the host, which answered 45 of 100 pages with 429. Those
   * pages are recorded honestly as unreachable — and if scoring counted them,
   * the cards would simply have swapped one set of pages nobody can fix for
   * another. A decorative image is the sharper case: its row reads "correctly
   * marked - no alt needed" and it was still earning priority points.
   */
  const informational = snapshot(
    crawled({ imagesDecorative: 11, blockedLinks: ["https://x.com/a"] }),
  );
  check(
    informational.issues.length > 0,
    "an informational row is still reported to the author",
    informational.issues.map((i) => i.code).join(", "),
  );
  check(
    priorityScore(informational, []).score === 0 &&
      opportunityScore(informational).score === 0,
    "but scores zero, so it cannot reach either card",
    `priority ${String(priorityScore(informational, []).score)}`,
  );

  const blocked = snapshot(
    crawled({
      status: 429,
      wordCount: 0,
      outcome: {
        state: "blocked",
        status: 429,
        finalUrl: "https://cinnamonsnail.com/vegan-taco-salad",
        redirected: false,
        detail: "Host refused the crawler (429)",
      },
    }),
  );
  check(
    blocked.issues.some((i) => i.code === "page_unreachable"),
    "a page the host refused is reported as unreachable",
  );
  check(
    priorityScore(blocked, []).score === 0,
    "and is not ranked as work the author can do",
    `priority ${String(priorityScore(blocked, []).score)}`,
  );

  /*
   * A stored issue does not get to outlive the rule that made it.
   *
   * Issues are computed once, at crawl time, and kept as JSON — so fixing a
   * check does not fix the reports already in the database. buildReport
   * reconciles what it reads against the evidence on the row, which is what
   * makes the correction reach a crawl that has already run.
   */
  const report = fs.readFileSync("lib/intelligence/report.ts", "utf8");
  check(
    /function reconcile\(issues: Issue\[\], row: PageRow\): Issue\[\]/.test(report),
    "stored issues are reconciled on the way out of the database",
  );
  check(
    /issues: reconcile\(parseIssues\(doc\.issues\), doc\)/.test(report),
    "and every snapshot goes through it — current crawl and comparison alike",
  );
  check(
    /row\.imagesMissingAltSrc\.length > 0/.test(report) &&
      /i\.code !== "missing_alt"/.test(report),
    "a stored missing-alt issue with no image to name is dropped",
  );

  // The card summary is drawn from the same reasons the detail lists.
  const reasons = priorityScore(real, []).reasons.map((r) => r.label);
  check(
    reasons.includes("Missing image alt text"),
    "the card's reason text names an issue the detail list also holds",
  );
  check(
    !priorityScore(stale, []).reasons.some((r) => r.label.includes("alt")),
    "and never names one the current crawl does not have",
  );
} finally {
  built.cleanup();
}

console.log(
  failures === 0
    ? "\nAll intelligence card checks passed.\n"
    : `\n${String(failures)} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
