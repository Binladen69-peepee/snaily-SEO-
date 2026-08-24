/**
 * Reads a draft back out of WordPress and reports what survived.
 *
 * Export reports what it *sent*. This reads what the site actually stored,
 * which is the only version of that claim worth anything: the CSS-driven step
 * numbering, the two-column grid, the Feast blocks and the WP Recipe Maker card
 * are all template markup the mapper has to leave alone, and "we did not touch
 * it" is not something a sender can verify about itself.
 *
 *   node --env-file=.env scripts/check-wp-draft.mjs <postId>
 */
import { PrismaClient } from "@prisma/client";

import { compile } from "./compile.mjs";

const built = compile(
  [
    "lib/db.ts",
    "lib/google/token-crypto.ts",
    "lib/wordpress/client.ts",
    "lib/wordpress/sync.ts",
  ],
  { prefix: ".wpcheck-" },
);
const Client = await built.load("lib/wordpress/client.ts");
const Sync = await built.load("lib/wordpress/sync.ts");

const prisma = new PrismaClient();

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

try {
  const postId = Number(process.argv[2]);
  if (!Number.isFinite(postId) || postId <= 0) {
    throw new Error("Pass a WordPress post ID.");
  }

  const row = await prisma.wordPressConnection.findFirst({
    select: { projectId: true },
  });
  if (row === null) throw new Error("No WordPress connection.");

  // The stored token is encrypted; `getCredentials` is the one place that
  // decrypts it, so this uses that rather than growing a second copy.
  const connection = await Sync.getCredentials(row.projectId);
  if (connection === null) throw new Error("Could not read the site credentials.");

  /*
   * The plugin's listing is walked in full rather than filtered by modified
   * date. The date filter compares against the site's own clock, not ours, and
   * a freshly created draft sitting just outside that comparison looks exactly
   * like a draft that was never created — which is the one thing this script
   * exists to be sure about.
   */
  let found = null;
  for (let page = 1; page <= 20 && found === null; page += 1) {
    const res = await Client.fetchPosts(connection.siteUrl, connection.token, {
      page,
      perPage: 100,
      modifiedAfter: null,
    });
    found = res.items.find((p) => p.id === postId) ?? null;
    if (page === 1) {
      console.log(`  listing: ${String(res.total)} posts across ${String(res.pages)} pages`);
    }
    if (res.pages <= page) break;
  }

  if (found === null) {
    throw new Error(
      `Post ${String(postId)} is not in the site's post listing at all.`,
    );
  }

  const html = found.content;
  const count = (re) => (html.match(re) ?? []).length;

  console.log(`\n${found.title}`);
  console.log(`  status            ${found.status}`);
  console.log(`  content           ${String(html.length)} chars\n`);

  console.log("Template markup that had to survive");
  const numpic = count(/numpic/g);
  const columns = count(/wp:columns/g);
  console.log(`  numpic classes    ${String(numpic)}`);
  console.log(`  column blocks     ${String(columns)}`);
  console.log(`  WP Recipe Maker   ${String(html.includes("wp-recipe-maker/recipe"))}`);
  console.log(`  Yoast FAQ block   ${String(html.includes("yoast/faq-block"))}`);
  console.log(`  Feast jump-to     ${String(html.includes("feast/advanced-jump-to-block"))}`);
  console.log(`  Feast related     ${String(html.includes("feast/fsri-block"))}`);
  console.log(`  feast-top-tip     ${String(count(/feast-top-tip/g))}`);

  check(found.status === "draft", "the post is a Draft");
  check(numpic >= 8, `the step-number classes survived (${String(numpic)})`);
  check(columns >= 4, `the two-column step grid survived (${String(columns)})`);
  check(html.includes("wp-recipe-maker/recipe"), "the WP Recipe Maker card is intact");
  check(html.includes("yoast/faq-block"), "the Yoast FAQ block is intact");
  check(html.includes("feast/advanced-jump-to-block"), "the Feast jump-to block is intact");
  check(html.includes("feast/fsri-block"), "the Feast related-recipes block is intact");

  console.log("\nWhat the article contributed");
  const faqQuestions = count(/"jsonQuestion"/g);
  const sponsored = count(/rel="sponsored nofollow"/g);
  const internal = count(/href="https:\/\/cinnamonsnail\.com/g);
  const images = count(/<!-- wp:image/g);
  console.log(`  FAQ questions     ${String(faqQuestions)}`);
  console.log(`  affiliate anchors ${String(sponsored)}`);
  console.log(`  internal anchors  ${String(internal)}`);
  console.log(`  image blocks      ${String(images)} (from the template, none uploaded)`);

  check(faqQuestions >= 3, `real questions reached the FAQ block (${String(faqQuestions)})`);
  check(sponsored > 0, `affiliate links carry rel="sponsored nofollow" (${String(sponsored)})`);
  check(!/<!-- snaily:todo -->/.test(html), "no placeholder marker reached WordPress");
  check(!/\[\[image:/.test(html), "no image marker reached WordPress");
} catch (err) {
  console.error("\n" + String(err?.stack ?? err));
  failures += 1;
} finally {
  await prisma.$disconnect().catch(() => {});
  built.cleanup?.();
}

console.log(failures === 0 ? "\nThe draft is intact.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
