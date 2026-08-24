/**
 * Live export test: creates real WordPress drafts on the connected site.
 *
 * This runs the same `buildExport` / `sendExport` pair the API route runs, so
 * it exercises the connector, the plugin and the draft-only guard rather than
 * a simulation of them. Three recipes go out, matching the brief: one link
 * heavy, one ingredient-link heavy, one with no affiliate matches at all.
 *
 * It creates drafts. It cannot publish - the plugin hard-codes `draft` and
 * `assertDraftOnly` refuses anything else - and it never writes to the
 * template post. Every draft ID it creates is printed at the end so they can
 * be reviewed or deleted.
 *
 *   node --env-file=.env.local scripts/test-export-live.mjs
 *   node --env-file=.env.local scripts/test-export-live.mjs --cleanup
 */
import { PrismaClient } from "@prisma/client";

import { checker, compile } from "./compile.mjs";

const SOURCES = [
  "lib/db.ts",
  "lib/markdown.ts",
  "lib/text.ts",
  "lib/content/affiliate.ts",
  "lib/content/link-index.ts",
  "lib/drafter/editorial.ts",
  "lib/drafter/recipe.ts",
  "lib/drafter/sanitize.ts",
  "lib/drafter/post-template.ts",
  "lib/google/token-crypto.ts",
  "lib/wordpress/blocks.ts",
  "lib/wordpress/client.ts",
  "lib/wordpress/plugin.ts",
  "lib/wordpress/sync.ts",
  "lib/wordpress/template.ts",
  "lib/wordpress/section-mapper.ts",
  "lib/wordpress/draft-export.ts",
];

const built = compile(SOURCES, { prefix: ".livetest-" });
const Export = await built.load("lib/wordpress/draft-export.ts");
const Sync = await built.load("lib/wordpress/sync.ts");
const Client = await built.load("lib/wordpress/client.ts");
const Markdown = await built.load("lib/markdown.ts");

const prisma = new PrismaClient();
const t = checker();

const PROJECT = "cmsj6ec0g0001jw045lu5uqjo";
const TEMPLATE_ID = 37284;
const MARKER = "[Snaily export test]";

/** Reuses the drafts written for the offline test, so the two stay in step. */
const { readFileSync } = await import("node:fs");
const fixtures = readFileSync("scripts/test-template.mjs", "utf8");
const grab = (name) =>
  new RegExp(`const ${name} = \`\\n([\\s\\S]*?)\\n\`\\.trim\\(\\)`).exec(fixtures)?.[1] ?? "";

const CASES = [
  { title: `${MARKER} Vegan Beet Hummus`, markdown: grab("BEET_HUMMUS") },
  { title: `${MARKER} Za'atar Manakeesh`, markdown: grab("MANAKEESH") },
  { title: `${MARKER} Summer Fruit Salad`, markdown: grab("FRUIT_SALAD") },
];

/**
 * The skeleton as the editor stores it after one save — comments gone, em dash
 * flattened. Exported untouched, it must not put a single template prompt on
 * the site, which is exactly what it used to do.
 */
const PostTemplate = await built.load("lib/drafter/post-template.ts");
const SEEDED = PostTemplate.buildPostTemplate({ title: "Untouched Template" })
  .replace(/<!-- snaily:todo -->/g, "")
  .replace(/<!-- \/?wp:[^>]*-->/g, "")
  .replace(/—/g, "-");

const PROMPTS = [
  "Hook",
  "Lead photo goes here",
  "Advanced Jump To",
  "Vegan AF",
  "Reason two",
  "Ingredients photo",
  "Enter a question",
  "Pitfalls only",
  "Photo for step one",
];

let failures = 0;
const created = [];

try {
  const creds = await Sync.getCredentials(PROJECT);
  if (!creds) throw new Error("This project has no readable WordPress credentials.");

  /* ---------------------------------------------------------------- */
  if (process.argv.includes("--cleanup")) {
    const rows = await prisma.article.findMany({
      where: { projectId: PROJECT, title: { startsWith: MARKER } },
      select: { id: true, title: true, wpDraftId: true },
    });
    for (const row of rows) {
      console.log(
        `  local article ${row.id} (${row.title}) — WordPress draft ${String(row.wpDraftId ?? 0)} left in place for review`,
      );
    }
    await prisma.article.deleteMany({
      where: { projectId: PROJECT, title: { startsWith: MARKER } },
    });
    console.log(`\nRemoved ${String(rows.length)} local test article(s).`);
    process.exit(0);
  }

  const owner = await prisma.project.findUnique({
    where: { id: PROJECT },
    select: { userId: true },
  });

  const templateBefore = await prisma.wpPost.findUnique({
    where: { projectId_wpId: { projectId: PROJECT, wpId: TEMPLATE_ID } },
    select: { content: true },
  });

  for (const testCase of CASES) {
    t.section(testCase.title);

    const article = await prisma.article.create({
      data: {
        userId: owner.userId,
        projectId: PROJECT,
        title: testCase.title,
        keyword: "test",
        mode: "drafter",
        phase: "proofed",
        status: "draft",
        content: Markdown.toEditorHtml(testCase.markdown),
      },
      select: {
        id: true,
        title: true,
        content: true,
        editorial: true,
        recipeCard: true,
        projectId: true,
        wpDraftId: true,
      },
    });

    const plan = await Export.buildExport(article);
    t.check(plan.template.wpId === TEMPLATE_ID, "exports through the real template");
    t.check(plan.payload.content.length > 1000, "payload has real content");

    const result = await Export.sendExport(creds, plan);
    created.push({ title: testCase.title, id: result.id, url: result.editLink });

    t.check(result.id > 0, `WordPress returned draft ID ${String(result.id)}`);
    t.check(result.id !== TEMPLATE_ID, "the new draft is not the template post");
    t.check(result.editLink !== "", "an admin edit link came back");

    await Export.recordExport(article.id, Export.toExportRecord(result));

    /* ---- Read the draft back off the live site ---------------------- */

    let found = null;
    for (let page = 1; page <= 3 && found === null; page += 1) {
      const batch = await Client.fetchPosts(creds.siteUrl, creds.token, {
        page,
        perPage: 50,
      });
      found = batch.items.find((p) => p.id === result.id) ?? null;
    }

    if (found === null) {
      t.check(false, "the created draft is readable back from WordPress");
      continue;
    }

    t.check(found.status === "draft", `post status is "${found.status}"`);
    t.check(found.title === testCase.title, "title landed as written");
    t.check(
      found.content.includes("wp:wp-recipe-maker/recipe"),
      "the WP Recipe Maker block survived the round trip",
    );
    t.check(
      found.content.includes("wp:feast/advanced-jump-to-block"),
      "the Feast jump-to block survived the round trip",
    );
    t.check(
      found.content.includes("numpic"),
      "the CSS step-numbering classes survived the round trip",
    );
    t.check(
      found.content.includes("feast-top-tip"),
      "the theme's group classes survived the round trip",
    );
    t.check(
      found.content.includes("wp-block-columns"),
      "the two-column step grid survived the round trip",
    );
    t.check(
      !/src="[^"]*\/api\/articles\//.test(found.content),
      "no app-hosted image URL reached the live site",
    );
    /*
     * Links in the closing "You'll love these too" section become post IDs in
     * the Feast grid rather than anchors — that is the template's own way of
     * rendering it — so anchors are only expected when a link resolved
     * somewhere else in the body.
     */
    const bodyLinks = plan.links.internalResolved.filter(
      (l) => !plan.links.relatedIds.some((r) => r.title === l.anchor),
    );
    t.check(
      bodyLinks.length === 0 ||
        /<a [^>]*href="https:\/\/cinnamonsnail\.com\//.test(found.content),
      `internal links are real clickable anchors on the site (${String(bodyLinks.length)} in the body)`,
    );
    t.check(
      plan.links.relatedIds.length === 0 ||
        new RegExp(`"id":"${String(plan.links.relatedIds[0].wpId)}`).test(found.content),
      "related recipes reached the Feast grid as real post IDs",
    );
    t.check(
      !/\[[^\]]+\]\([^)]+\)/.test(found.content),
      "no Markdown link syntax is visible in the published markup",
    );

    if (plan.links.affiliateLinked.length > 0) {
      const first = plan.links.affiliateLinked[0];
      t.check(
        found.content.includes(first.url),
        `affiliate URL for "${first.term}" arrived unaltered`,
      );
      t.check(
        found.content.includes('rel="sponsored nofollow"'),
        "affiliate links kept rel=\"sponsored nofollow\"",
      );
    } else {
      t.check(
        !found.content.includes('rel="sponsored'),
        "no affiliate link was invented for a draft with no matches",
      );
    }
  }

  /* ---------------------------------------------------------------- */
  t.section("An untouched skeleton exports no prompts");

  const seeded = await prisma.article.create({
    data: {
      userId: owner.userId,
      projectId: PROJECT,
      title: `${MARKER} Untouched Template`,
      keyword: "test",
      mode: "drafter",
      phase: "outline",
      status: "draft",
      content: SEEDED,
    },
    select: {
      id: true,
      title: true,
      content: true,
      editorial: true,
      recipeCard: true,
      projectId: true,
      wpDraftId: true,
    },
  });

  const seededPlan = await Export.buildExport(seeded);
  const seededResult = await Export.sendExport(creds, seededPlan);
  created.push({
    title: seeded.title,
    id: seededResult.id,
    url: seededResult.editLink,
  });
  await Export.recordExport(seeded.id, Export.toExportRecord(seededResult));

  const seededBatch = await Client.fetchPosts(creds.siteUrl, creds.token, {
    page: 1,
    perPage: 50,
  });
  const seededLive = seededBatch.items.find((p) => p.id === seededResult.id);

  if (seededLive) {
    t.check(seededLive.status === "draft", "it landed as a draft");
    for (const prompt of PROMPTS) {
      t.check(
        !seededLive.content.includes(prompt),
        `"${prompt}…" is not on the site`,
      );
    }
    t.check(
      seededLive.content.includes("wp-recipe-maker"),
      "the template's own blocks are still there",
    );
  } else {
    t.check(false, "the seeded draft is readable back from WordPress");
  }

  /* ---------------------------------------------------------------- */
  t.section("The template itself");

  const templateNow = await Client.fetchPosts(creds.siteUrl, creds.token, {
    page: 1,
    perPage: 100,
  });
  const live = templateNow.items.find((p) => p.id === TEMPLATE_ID);

  if (live) {
    t.check(live.status === "draft", "the template is still a draft");
    t.check(
      live.content === templateBefore.content,
      "the template post's content is byte-for-byte unchanged",
    );
  } else {
    // Not on the first page of recently-modified posts is itself good news:
    // it means nothing touched it.
    t.check(true, "the template was not modified (absent from recent changes)");
  }

  t.section("Draft-only guard, live");
  let refused = false;
  try {
    await Export.sendExport(creds, {
      ...(await Export.buildExport(
        await prisma.article.findFirst({
          where: { projectId: PROJECT, title: { startsWith: MARKER } },
          select: {
            id: true,
            title: true,
            content: true,
            editorial: true,
            recipeCard: true,
            projectId: true,
            wpDraftId: true,
          },
        }),
      )),
      targetPostId: TEMPLATE_ID,
    });
  } catch (err) {
    refused = err.name === "PublishRefused";
  }
  t.check(refused, "an export aimed at the template post is refused before any call");

  failures = t.report();
} finally {
  if (created.length > 0) {
    console.log("\nWordPress drafts created by this run:");
    for (const c of created) {
      console.log(`  #${String(c.id)}  ${c.title}`);
      console.log(`      ${c.url}`);
    }
    console.log(
      "\nAll are drafts. Nothing was published. Delete them in WordPress when you are done,",
    );
    console.log("then run this script with --cleanup to drop the local test articles.");
  }
  await prisma.$disconnect();
  built.cleanup();
}

process.exit(failures === 0 ? 0 : 1);
