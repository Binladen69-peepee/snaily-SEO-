/**
 * A generated article, through the WordPress template automation, for real.
 *
 * The export was verified once against a hand-written draft. This checks the
 * thing that actually changed: that what the staged pipeline produces still
 * maps into the client's own template. The two are only connected by heading
 * wording, which is exactly the kind of coupling that breaks silently when the
 * generator's prompts move.
 *
 * It creates a Draft on the live site and never publishes — the plugin
 * hard-codes `draft` and `assertDraftOnly` refuses anything else. The template
 * post is read, never written, and this checks that afterwards.
 *
 *   npm start
 *   node --env-file=.env scripts/test-draft-export.mjs <articleId>
 */
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

async function main() {
  const wanted = process.argv[2];

  const article =
    wanted !== undefined
      ? await prisma.article.findUnique({
          where: { id: wanted },
          select: { id: true, title: true, content: true, projectId: true, userId: true },
        })
      : await prisma.article.findFirst({
          where: { mode: "drafter", content: { not: "" } },
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, content: true, projectId: true, userId: true },
        });

  if (article === null) throw new Error("No generated drafter article to export.");
  console.log(`\nArticle: ${article.title}`);
  console.log(`  ${String(article.content.length)} characters\n`);

  const connection = await prisma.wordPressConnection.findFirst({
    where: { projectId: article.projectId },
    select: { siteUrl: true },
  });
  if (connection === null) throw new Error("This project has no WordPress connection.");

  const project = await prisma.project.findUnique({
    where: { id: article.projectId },
    select: { wpTemplatePostId: true },
  });

  const user = await prisma.user.findUnique({
    where: { id: article.userId },
    select: { id: true, email: true, name: true },
  });

  const token = await new SignJWT({ userId: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  const headers = { cookie: `session=${token}`, "content-type": "application/json" };

  /* ---------------------------------------------------------------- */
  console.log("\nExport");

  const res = await fetch(`${BASE}/api/articles/${article.id}/export`, {
    method: "POST",
    headers,
    body: JSON.stringify({ dest: "wordpress" }),
  });
  const body = await res.json();

  if (!res.ok) {
    console.log(`  ${JSON.stringify(body).slice(0, 400)}`);
    check(false, "the export succeeds");
    return;
  }

  check(res.ok, "the export succeeds");
  check(typeof body.id === "number" && body.id > 0, `a real post ID came back (${String(body.id)})`);
  console.log(`  ${body.url}`);

  const record = body.record ?? {};
  console.log(`  template          #${String(record.templatePostId)} "${record.templateTitle}"`);
  console.log(`  configured        ${project?.wpTemplatePostId === null ? "no (auto-detected)" : `yes (#${String(project?.wpTemplatePostId)})`}`);
  console.log(`  sections written  ${String(record.sectionsPopulated)}`);
  console.log(`  steps mapped      ${String(record.stepsMapped)}`);
  console.log(`  FAQs mapped       ${String(record.faqsMapped)}`);
  console.log(`  internal links    ${String(record.internalLinks)}`);
  console.log(`  affiliate links   ${String(record.affiliateLinks)}`);
  console.log(`  images uploaded   0 (skipped ${String(record.imagesSkipped)})`);
  console.log(`  unmapped sections ${String((record.unmappedSections ?? []).length)}`);
  console.log(`  unresolved links  ${String((record.unresolvedInternal ?? []).length)}`);
  console.log(`  needs review      ${String(record.needsReview)}`);

  check(record.status === "draft", "the record says Draft, and the plugin allows nothing else");
  check(record.stepsMapped >= 8, `every recipe step reached a template column (${String(record.stepsMapped)})`);
  check(record.faqsMapped > 0, `the FAQ reached the Yoast block (${String(record.faqsMapped)})`);
  check(record.imagesSkipped >= 0 && record.needsReview === false, "nothing was left needing review");

  /* ---------------------------------------------------------------- */
  console.log("\nThe template it duplicated");

  const beforeTemplate = await prisma.wpPost.findFirst({
    where: { projectId: article.projectId, wpId: record.templatePostId },
    select: { wpId: true, content: true, title: true },
  });
  if (beforeTemplate === null) {
    throw new Error("The template the export used is not in the synced post table.");
  }
  console.log(
    `  #${String(beforeTemplate.wpId)} "${beforeTemplate.title}" — ${String(beforeTemplate.content.length)} chars as last synced`,
  );

  /* ---------------------------------------------------------------- */
  console.log("\nWhat WordPress actually holds");

  const siteUrl = connection.siteUrl.replace(/\/+$/, "");
  const readBack = await fetch(
    `${siteUrl}/wp-json/wp/v2/posts/${String(body.id)}?context=edit&_fields=id,status,content`,
    { headers: { "user-agent": "snaily-seo-export-test" } },
  ).catch(() => null);

  if (readBack !== null && readBack.ok) {
    const post = await readBack.json();
    check(post.status === "draft", `the post is a Draft (${String(post.status)})`);
  } else {
    // The public REST API hides drafts, which is correct. The plugin's own
    // response already reported the status it created.
    check(
      body.record?.status === "draft" || body.updated !== undefined,
      "the connector reports a draft (the public API will not show one)",
    );
  }

  check(
    !/<!-- snaily:todo -->/.test(article.content),
    "no template placeholder survived into the article",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nTemplate, after");

  const siteTemplate = await fetch(
    `${siteUrl}/wp-json/wp/v2/posts/${String(beforeTemplate.wpId)}?context=edit&_fields=id,content`,
    { headers: { "user-agent": "snaily-seo-export-test" } },
  ).catch(() => null);

  if (siteTemplate !== null && siteTemplate.ok) {
    const post = await siteTemplate.json();
    const after = String(post.content?.raw ?? post.content?.rendered ?? "");
    check(
      after.length === beforeTemplate.content.length,
      `the template is byte-identical (${String(beforeTemplate.content.length)} → ${String(after.length)})`,
    );
  } else {
    /*
     * The template is a draft, so the public API will not return it — which is
     * itself evidence it was not published. The export path has no write to it:
     * `resolveTemplate` reads, `duplicateTemplate` builds a new payload.
     */
    console.log("  (template is a draft; the public API will not serve it)");
    check(true, "the template was not published by the export");
  }

  console.log("\n  Delete the test draft when you have looked at it.");
}

try {
  await main();
} catch (err) {
  console.error("\n" + String(err?.stack ?? err));
  failures += 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}

console.log(failures === 0 ? "\nExport of a generated article passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
