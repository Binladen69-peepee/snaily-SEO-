/**
 * A real export to the real site, checked field by field.
 *
 * Creates a draft (never publishes — the connector hard-codes `draft` and
 * `assertDraftOnly` refuses anything else), then reads that draft back out of
 * WordPress and asserts against what came back rather than what was sent.
 * Reading back is the whole point: everything here has at some stage looked
 * correct on the way out and landed wrong.
 *
 * Fields that need a newer connector than the site has installed are reported
 * as BLOCKED rather than FAIL, because a red line the client cannot act on is
 * worse than no line.
 *
 *   npm run dev
 *   npm run verify:wp -- <articleId>
 */
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";
import { createDecipheriv, createHash } from "node:crypto";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();

/** The connector version that first understood the newer fields. */
const NEEDS = "1.4.0";

let pass = 0;
let fail = 0;
let blocked = 0;

const ok = (cond, label, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? (pass += 1) : (fail += 1);
};
const block = (label, why) => {
  console.log(`  BLOCKED  ${label} — ${why}`);
  blocked += 1;
};

function decrypt(payload) {
  const [iv, tag, data] = payload.split(":");
  const key = createHash("sha256").update(process.env.AUTH_SECRET).digest();
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(data, "hex")), d.final()]).toString("utf8");
}

function versionAtLeast(actual, wanted) {
  const a = String(actual).split(".").map(Number);
  const w = String(wanted).split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (w[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (w[i] ?? 0)) return false;
  }
  return true;
}

async function connector(siteUrl, token, path, init = {}) {
  const res = await fetch(`${siteUrl}/wp-json/snailyseo/v1${path}`, {
    headers: {
      "x-snaily-token": token,
      Accept: "application/json",
      "User-Agent": "SnailySEO/1.0 (+connector)",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...init,
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const wanted = process.argv[2];

  const article =
    wanted !== undefined
      ? await prisma.article.findUnique({ where: { id: wanted } })
      : await prisma.article.findFirst({
          where: { mode: "drafter", content: { not: "" } },
          orderBy: { updatedAt: "desc" },
        });
  if (article === null) throw new Error("No drafted article to export.");

  const conn = await prisma.wordPressConnection.findUnique({
    where: { projectId: article.projectId },
  });
  if (conn === null) throw new Error("This project has no WordPress connection.");
  const token = decrypt(conn.token);

  const project = await prisma.project.findUnique({
    where: { id: article.projectId },
    select: { wpTemplatePostId: true },
  });

  const user = await prisma.user.findUnique({
    where: { id: article.userId },
    select: { id: true, email: true, name: true },
  });

  const sessionCookie = async () =>
    new SignJWT({ userId: user.id, email: user.email, name: user.name })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  console.log(`\nArticle : ${article.title}`);
  console.log(`Keyword : ${article.keyword}`);
  console.log(`Site    : ${conn.siteUrl}`);

  /* ---- What the installed connector can do ------------------------- */

  const site = await connector(conn.siteUrl, token, "/site");
  const installed = String(site.body.plugin_version ?? "0.0.0");
  const supports = site.body.supports ?? {};
  const modern = versionAtLeast(installed, NEEDS);

  console.log(`Connector: ${installed}${modern ? "" : `  (needs ${NEEDS} for the newer fields)`}`);
  console.log(`SEO plugin: ${site.body.seo_plugin}`);

  /* ---- The template, before ---------------------------------------- */

  /*
   * The template is found by title rather than stored on the project, so ask
   * the export preview which post it resolved to instead of guessing.
   */
  const previewRes = await fetch(`${BASE}/api/articles/${article.id}/export`, {
    headers: { cookie: `session=${await sessionCookie()}` },
  });
  const preview = previewRes.ok ? await previewRes.json() : {};
  const templateId =
    preview.template?.wpId ?? preview.preview?.template?.wpId ?? project?.wpTemplatePostId ?? 0;

  let templateBefore = null;
  if (templateId > 0) {
    const found = await connector(conn.siteUrl, token, `/posts?per_page=100`);
    templateBefore = (found.body.items ?? []).find((p) => p.id === templateId) ?? null;
  }

  /* ---- Export ------------------------------------------------------- */

  const jwt = await sessionCookie();

  console.log("\nExporting…");
  const res = await fetch(`${BASE}/api/articles/${article.id}/export`, {
    method: "POST",
    headers: { cookie: `session=${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ dest: "wordpress" }),
  });
  const out = await res.json();

  if (!res.ok) {
    console.log("Export refused:", JSON.stringify(out).slice(0, 400));
    return;
  }

  const draftId = out.id ?? out.draftId ?? out.result?.id;
  console.log(`Draft post ID: ${draftId}`);
  console.log(`Edit link    : ${out.editLink ?? out.result?.editLink ?? "(none)"}`);

  /* ---- Read it back ------------------------------------------------- */

  const listed = await connector(conn.siteUrl, token, "/posts?per_page=20");
  const draft = (listed.body.items ?? []).find((p) => p.id === draftId);

  if (draft === undefined) {
    console.log("\nCould not read the draft back from WordPress.");
    fail += 1;
    return;
  }

  const html = String(draft.content ?? "");
  const seo = draft.seo ?? {};

  /* ---- The document the author reads --------------------------------- */

  console.log("\nThe document format");

  const docHtml = String(article.content ?? "");
  const place = (needle) => docHtml.indexOf(needle);
  const iRelated = place("also love these");
  const iFsriLine = place("FSRI post IDs");
  const iCard = place("Recipe Card");
  const iYoast = place("Yoast SEO");

  ok(iRelated > 0, "the document ends on you'll also love these");
  ok(iFsriLine > iRelated, "with the verified FSRI post IDs under it");
  ok(iCard > iFsriLine, "then the recipe card");
  ok(iYoast > iCard, "then the Yoast block, last");

  const docIds = /FSRI post IDs:<\/strong>\s*([0-9,\s]+)/.exec(docHtml);
  const docIdList = (docIds?.[1] ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  ok(docIdList.length > 0, "the document names the post IDs the grid will use", docIdList.join(", "));
  if (docIdList.length < 4) {
    console.log(
      `  NOTE  only ${String(docIdList.length)} of 4 related recipes matched a published post — the grid will be short`,
    );
  }

  /*
   * A field is required in the document only when the card actually holds it.
   *
   * Times, yield and cost are never derived — they exist in the author's paste
   * or nowhere, and a cook time nobody stated is a false claim published as
   * structured data. So the test is "printed if present, absent if not", which
   * is the rule the document is built on; asserting all of them unconditionally
   * would be asking the exporter to invent.
   */
  const storedCard = article.recipeCard ?? {};
  const cardChecks = [
    ["Summary", "<strong>Summary:</strong>", storedCard.openingSentence || storedCard.description],
    ["Yield", "<strong>Yield:</strong>", storedCard.recipeYield],
    ["Estimated Cost", "<strong>Estimated Cost:</strong>", storedCard.estimatedCost],
    ["Prep Time", "<strong>Prep Time:</strong>", storedCard.prepMinutes],
    ["Cook Time", "<strong>Cook Time:</strong>", storedCard.cookMinutes],
    ["Courses", "<strong>Courses:</strong>", storedCard.category],
    ["Cuisine", "<strong>Cuisine:</strong>", storedCard.cuisine],
    ["Equipment", "<strong>Equipment:</strong>", (storedCard.equipment ?? []).length],
    ["Ingredients", "<strong>Ingredients:</strong>", (storedCard.ingredients ?? []).length],
    ["Instructions", "<strong>Instructions:</strong>", (storedCard.steps ?? []).length],
  ];

  for (const [label, needle, value] of cardChecks) {
    const has = value !== undefined && value !== null && value !== "" && value !== 0;
    const printed = docHtml.includes(needle);
    if (has) {
      ok(printed, `the card in the document carries ${label}`);
    } else {
      ok(!printed, `${label} is not stated, so it is not printed`, "omitted, not guessed");
    }
  }

  const anyTime =
    (storedCard.prepMinutes ?? 0) + (storedCard.cookMinutes ?? 0) + (storedCard.customMinutes ?? 0);
  ok(
    docHtml.includes("<strong>Total Time:</strong>") === anyTime > 0,
    anyTime > 0 ? "the card shows a total time" : "no times means no total time",
  );

  for (const [label, needle] of [
    ["Focus keyphrase", "<strong>Focus keyphrase:</strong>"],
    ["Meta description", "<strong>Meta description:</strong>"],
    ["URL slug", "<strong>URL slug:</strong>"],
    ["Primary Category", "<strong>Primary Category:</strong>"],
  ]) {
    ok(docHtml.includes(needle), `the Yoast block in the document carries ${label}`);
  }

  console.log("\nPost");
  ok(draft.status === "draft", "final post status is DRAFT", draft.status);
  ok(draft.title === article.title || draft.title.length > 0, "title written", draft.title.slice(0, 50));
  ok(
    templateId > 0 && draftId !== templateId,
    "the template was duplicated, not written to",
    `template #${templateId}, draft #${draftId}`,
  );

  console.log("\nSections and markup");
  const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim(),
  );
  ok(h2.length >= 6, `article sections populated`, `${h2.length} H2s`);
  ok(
    /wp:yoast\/faq-block/.test(html) && !/&lt;!--\s*wp:yoast/.test(html),
    "FAQ uses a real Yoast FAQ block, not escaped text",
  );
  ok(!/<<<SECTION|<<<END/.test(html), "no pipeline markers leaked into the post");

  const fsri = /wp:feast\/fsri-block\s*(\{.*?\})/.exec(html);
  const fsriIds = fsri
    ? (JSON.parse(fsri[1]).id ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  ok(fsriIds.length === 4, "Feast FSRI block carries 4 related post IDs", fsriIds.join(", "));

  const stepH3 = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim(),
  );
  const numbered = stepH3.filter((h) => /^Step [A-Z][a-z]+$/.test(h));
  ok(
    numbered.length > 0 && numbered.length === stepH3.filter((h) => /^Step/i.test(h)).length,
    "step H3s carry only the written number",
    stepH3.slice(0, 3).join(" / "),
  );
  ok(
    !/<h3[^>]*>[^<]*(?: - |:)/i.test(html),
    "no pun was left welded into a step heading",
  );

  const whySection = html.split(/(?=<h2)/i).find((s) => /Why you'?ll adore/i.test(s)) ?? "";
  ok(
    whySection !== "" && !/<ul|<ol/i.test(whySection),
    "Why You'll Adore is not exported as a bulleted list",
  );

  console.log("\nRecipe integrity");
  const card = article.recipeCard ?? {};
  const sourceIngredients = Array.isArray(card.ingredients) ? card.ingredients : [];

  if (!modern || supports.recipe !== true) {
    block(
      "WPRM recipe card created",
      supports.recipe === false
        ? "WP Recipe Maker is not active on the site"
        : `connector ${installed} predates recipe-card creation (needs ${NEEDS})`,
    );
    block("nutrition analysis attached", "no recipe card was created");
  } else {
    const recipe = draft.recipe ?? null;
    ok(recipe !== null, "a WPRM recipe card exists on the draft", `id ${recipe?.id}`);
    ok(
      recipe !== null && recipe.ingredient_count === sourceIngredients.length,
      "every source ingredient is on the card",
      `${recipe?.ingredient_count} of ${sourceIngredients.length}`,
    );
    const saved = recipe?.ingredients ?? [];
    ok(
      saved.length > 0 && saved.every((line, i) => line === sourceIngredients[i]),
      "ingredient lines are byte-for-byte the author's own",
    );
    ok(
      recipe !== null && recipe.instruction_count > 0,
      "instructions are on the card",
      `${recipe?.instruction_count}`,
    );
    ok(
      recipe !== null && recipe.calories !== null && recipe.calories > 0,
      "nutrition analysis is attached to the card",
      `${recipe?.nutrition_fields} fields, ${recipe?.calories} kcal`,
    );
  }

  console.log("\nYoast");
  ok(String(seo.title ?? "") !== "", "SEO title populated", String(seo.title).slice(0, 45));
  ok(String(seo.description ?? "") !== "", "meta description populated");
  ok(String(draft.slug ?? "") !== "", "slug populated", draft.slug);

  if (!modern) {
    block("focus keyphrase populated", `connector ${installed} does not write it (needs ${NEEDS})`);
    block("Yoast noindex = NO", `connector ${installed} does not write it (needs ${NEEDS})`);
    block("Yoast nofollow = NO", `connector ${installed} does not write it (needs ${NEEDS})`);
    block("primary category set", `connector ${installed} does not write it (needs ${NEEDS})`);
  } else {
    ok(
      String(seo.focus_keyword ?? "").toLowerCase() === article.keyword.toLowerCase(),
      "focus keyphrase equals the target keyword",
      String(seo.focus_keyword),
    );
    ok(seo.noindex === false, "Yoast noindex = NO", String(seo.noindex));
    ok(seo.nofollow === false, "Yoast nofollow = NO", String(seo.nofollow));
    ok(
      String(seo.primary_category ?? "") !== "",
      "primary category set",
      String(seo.primary_category),
    );
  }

  console.log("\nExcerpt");
  const excerpt = String(draft.excerpt ?? "").replace(/<[^>]+>/g, "").trim();
  ok(excerpt !== "", "the excerpt is populated", excerpt.slice(0, 60));
  ok(
    excerpt === String(seo.description ?? "").trim(),
    "and is the same string as the meta description, not a second one",
  );

  console.log("\nThe worksheet does not ship");
  ok(
    !/Yoast SEO/i.test(html),
    "the Yoast block is consumed as fields, never printed on the page",
  );
  ok(
    !/FSRI post IDs/i.test(html),
    "nor is the FSRI ID line — the grid renders instead",
  );
  ok(
    !/<strong>URL slug:<\/strong>/i.test(html),
    "nor the slug line",
  );

  console.log("\nTerms");
  const cats = draft.categories ?? [];
  const tags = draft.tags ?? [];
  ok(cats.length > 0 && !cats.includes("Uncategorized"), "categories populated", cats.join(", "));
  console.log(
    `  NOTE     tags: ${tags.length > 0 ? tags.join(", ") : "none — this site has one tag, used once"}`,
  );

  console.log("\nLinks");
  const anchors = [...html.matchAll(/<a\b([^>]*)>/gi)].map((m) => m[1]);
  const internal = anchors.filter((a) => a.includes(conn.siteUrl));
  const external = anchors.filter((a) => !a.includes(conn.siteUrl));
  ok(internal.length > 0, "internal links present", `${internal.length}`);
  ok(
    internal.every((a) => !/nofollow/i.test(a)),
    "internal links are dofollow",
  );
  ok(
    external.length === 0 || external.every((a) => /rel=/i.test(a)),
    "external and affiliate links carry a rel attribute",
    `${external.length} external`,
  );
  /*
   * Only the internal ones. An affiliate term can legitimately appear twice
   * in a post - the ingredient list and the specialty section both name the
   * miso - and the client's ask was about internal links reading naturally.
   */
  const anchorText = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((m) => m[1].includes(conn.siteUrl))
    .map((m) => m[2].replace(/<[^>]+>/g, "").trim())
    .filter((t) => t.length > 0);
  ok(
    new Set(anchorText).size === anchorText.length,
    "no internal anchor text is repeated",
  );
  ok(
    anchorText.every((t) => t !== t.toUpperCase() || t.length < 4),
    "anchor text is sentence case, not shouting",
  );

  console.log("\nImages and the template");
  ok(
    !/\/api\/articles\/[^"']+\/media\//.test(html),
    "no app-hosted images were uploaded",
  );

  if (templateBefore !== null) {
    const after = await connector(conn.siteUrl, token, "/posts?per_page=100");
    const templateAfter = (after.body.items ?? []).find((p) => p.id === templateId);
    ok(
      templateAfter !== undefined &&
        templateAfter.modified_at === templateBefore.modified_at,
      "the Blog Post Template was not modified",
      `#${templateId}`,
    );
  } else {
    console.log("  NOTE     template not found in the first page of posts; skipped");
  }

  console.log(`\n${pass} passed, ${fail} failed, ${blocked} blocked`);
  console.log(`Draft post ID used for testing: ${draftId}\n`);
}

main()
  .catch((err) => {
    console.error("\n", err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
