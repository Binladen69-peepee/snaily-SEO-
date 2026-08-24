/**
 * One click, end to end, against a running server and the real provider.
 *
 * This is the test the feature is actually judged by: create an article, press
 * the button once, and watch a background job write a finished post without the
 * browser doing anything but asking how it is going. It runs against a live
 * Next server so the parts that only exist in production — `after()` chaining
 * between invocations, the lease, the poll-driven recovery — are the ones being
 * exercised, not a stand-in for them.
 *
 * It also stops polling partway through on purpose. That is what closing the
 * laptop looks like from the server's side, and the job has to finish anyway.
 *
 *   npm run dev
 *   node --env-file=.env scripts/test-draft-live.mjs
 *
 * Pass --keep to leave the article behind for inspection.
 */
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const TIMEOUT_MS = 12 * 60 * 1000;

const prisma = new PrismaClient();

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

/** A real recipe from the client's own kitchen, pasted the way they paste it. */
const KABOCHA_RECIPE = `Ingredients
2 tablespoons olive oil
1 large yellow onion, diced
4 cloves garlic, minced
2 tablespoons gochujang
1 tablespoon white miso paste
1 medium kabocha squash (about 3 pounds / 1.4 kg), peeled and cubed
4 cups (960 ml) vegetable broth
1 can (13.5 ounces / 400 ml) full fat coconut milk
1 tablespoon maple syrup
2 teaspoons rice vinegar
1 teaspoon kosher salt
2 scallions, thinly sliced
1 tablespoon toasted sesame seeds

Instructions
1. Warm the olive oil in a large pot over medium heat, then cook the onion until it turns translucent, about 6 minutes.
2. Add the garlic and cook for 1 minute, until it smells like garlic and not like raw garlic.
3. Stir in the gochujang and miso paste and cook for 2 minutes so they lose their raw edge.
4. Add the kabocha squash and vegetable broth, then bring it up to a simmer.
5. Cover and simmer for 20 minutes, until the squash gives way easily to a fork.
6. Blend the soup until completely smooth, working in batches if your blender is small.
7. Return the soup to the pot and stir in the coconut milk, maple syrup, rice vinegar and salt.
8. Warm it through over low heat, then top each bowl with scallions and sesame seeds.`;

/** The same mushroom stroganoff paste the client compared against Tamale Pie. */
const STROGANOFF_RECIPE = `Ingredients

- 16 oz cremini mushrooms, sliced
- 1 tbsp olive oil
- 1 medium yellow onion, finely chopped
- 4 cloves garlic, minced
- 1 tbsp all-purpose flour
- 2 cups vegetable broth
- 1 tbsp soy sauce
- 1 tsp Dijon mustard
- 1 tsp smoked paprika
- 1/2 tsp dried thyme
- 1/2 tsp black pepper
- 1/2 tsp salt, or to taste
- 1 cup unsweetened vegan sour cream
- 12 oz wide noodles
- 2 tbsp chopped fresh parsley

Instructions

1. Bring a large pot of salted water to a boil and cook the noodles according to the package directions. Drain and set aside.

2. Heat the olive oil in a large skillet over medium-high heat. Add the mushrooms and cook for 6-8 minutes, stirring occasionally, until browned and their moisture has cooked away.

3. Add the onion and cook for 4-5 minutes, until softened. Stir in the garlic and cook for another 30 seconds.

4. Sprinkle the flour over the mushroom mixture and stir well so everything is evenly coated. Cook for 1 minute.

5. Slowly pour in the vegetable broth while stirring. Add the soy sauce, Dijon mustard, smoked paprika, thyme, black pepper, and salt.

6. Reduce the heat to medium and simmer for 5-7 minutes, stirring occasionally, until the sauce thickens.

7. Remove the skillet from the heat and stir in the vegan sour cream until smooth and creamy.

8. Add the cooked noodles to the sauce and toss until everything is well coated. Taste and adjust the seasoning as needed.

9. Sprinkle with fresh parsley and serve immediately.`;

const DISH = (process.env.TEST_DISH ?? "").toLowerCase();
const RECIPE = DISH === "stroganoff" ? STROGANOFF_RECIPE : KABOCHA_RECIPE;
const TITLE =
  DISH === "stroganoff"
    ? "Vegan Mushroom Stroganoff"
    : "Vegan Gochujang Kabocha Squash Soup";
const KEYWORD =
  DISH === "stroganoff" ? "vegan mushroom stroganoff" : "vegan kabocha squash soup";

async function main() {
  /*
   * The project with the most synced posts, not the oldest one.
   *
   * Half this pipeline reads from WordPress — the voice brief, the internal
   * link index, the affiliate terms — so running it against an unsynced
   * project tests the fallbacks and calls it a pass. TEST_PROJECT_ID overrides.
   */
  const configuredId = (process.env.TEST_PROJECT_ID ?? "").trim();
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      userId: true,
      name: true,
      _count: { select: { wpPosts: true } },
    },
  });
  const project =
    (configuredId === ""
      ? [...projects].sort((a, b) => b._count.wpPosts - a._count.wpPosts)[0]
      : projects.find((p) => p.id === configuredId)) ?? null;
  if (project === null) throw new Error("No project in the database.");
  if (project._count.wpPosts === 0) {
    throw new Error(
      "The chosen project has no synced WordPress posts, so links and voice cannot be tested.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: project.userId },
    select: { id: true, email: true, name: true },
  });
  if (user === null) throw new Error("Project has no owner.");

  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  const headers = { cookie: `session=${token}`, "content-type": "application/json" };
  const api = (path, init = {}) =>
    fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init.headers } });

  console.log(`\nProject: ${project.name}`);
  console.log(`Server:  ${BASE}\n`);

  /* -------------------------------------------------------------- */
  console.log("Creating the article");

  const created = await api("/api/articles", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      title: TITLE,
      keyword: KEYWORD,
      mode: "drafter",
      recipe: RECIPE,
    }),
  });
  const createdBody = await created.json();
  check(created.status === 201, "the article is created");
  const articleId = createdBody.id;
  if (!articleId) throw new Error(`No article id: ${JSON.stringify(createdBody)}`);

  const before = await prisma.article.findUnique({
    where: { id: articleId },
    select: { content: true },
  });
  check(before.content === "", "a new drafter article starts empty, not templated");

  /* -------------------------------------------------------------- */
  console.log("\nOne click");

  const started = await api(`/api/articles/${articleId}/draft-job`, { method: "POST" });
  const startedBody = await started.json();
  check(started.status === 201, "the button returns a job");
  const jobId = startedBody.job?.id;
  if (!jobId) throw new Error(`No job: ${JSON.stringify(startedBody)}`);
  check(startedBody.job.total === 16, "the job has all sixteen stages");

  const second = await api(`/api/articles/${articleId}/draft-job`, { method: "POST" });
  const secondBody = await second.json();
  check(
    secondBody.job.id === jobId && secondBody.created === false,
    "a double click lands on the same job",
  );

  /* -------------------------------------------------------------- */
  console.log("\nWatching");

  const startedAt = Date.now();
  let last = "";
  let job = startedBody.job;
  let refreshSimulated = false;

  while (Date.now() - startedAt < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 3_000));

    /*
     * Halfway through, stop polling for 20 seconds. That is what closing the
     * tab looks like from here — no client, no chain kick from a poll — and the
     * job has to keep going on its own.
     */
    if (!refreshSimulated && job.done >= 4) {
      refreshSimulated = true;
      console.log("  … simulating a browser close for 20s");
      await new Promise((r) => setTimeout(r, 20_000));
    }

    const res = await api(`/api/draft-jobs/${jobId}`);
    if (!res.ok) {
      console.log(`  poll failed: ${String(res.status)}`);
      continue;
    }
    const body = await res.json();
    job = body.job;

    const line = `${String(job.done)}/${String(job.total)} ${job.stage || job.status}`;
    if (line !== last) {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  [${String(secs).padStart(3)}s] ${line}`);
      last = line;
    }

    if (["completed", "failed", "cancelled"].includes(job.status)) break;
  }

  check(job.status === "completed", `the job completes (ended as ${job.status})`);
  if (job.status === "failed") {
    console.log(`  failure: ${job.errorCode} — ${job.errorMessage}`);
  }
  check(refreshSimulated, "the job survived a gap in polling");

  /* -------------------------------------------------------------- */
  console.log("\nThe article");

  const article = await (await api(`/api/articles/${articleId}`)).json();
  const html = article.content ?? "";

  const text = html
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const proseWords = text.split(/\s+/).filter(Boolean).length;
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim(),
  );
  const steps = (html.match(/<h3\b/gi) ?? []).length;
  const emojiHeadings = headings.filter((h) =>
    /^\s*\p{Extended_Pictographic}/u.test(h),
  ).length;
  const internal = (html.match(/<a href="https?:\/\/[^"]*cinnamonsnail[^"]*"/gi) ?? []).length;
  const sponsored = (html.match(/rel="sponsored nofollow"/gi) ?? []).length;
  const emDashes = (html.match(/—/g) ?? []).length;

  console.log(`  prose words     ${String(proseWords)}`);
  console.log(`  H2 sections     ${String(headings.length)} (${String(emojiHeadings)} emoji-led)`);
  console.log(`  H3 steps        ${String(steps)}`);
  console.log(`  internal links  ${String(internal)}`);
  console.log(`  affiliate links ${String(sponsored)}`);
  console.log(`  title           ${article.title}`);
  console.log(`  slug            ${article.editorial?.slug ?? ""}`);
  console.log(`  meta            ${(article.editorial?.seoDescription ?? "").slice(0, 80)}…`);
  console.log("  headings:");
  for (const h of headings) console.log(`    ${h}`);
  console.log("  opening:");
  console.log(`    ${text.replace(/\s+/g, " ").trim().slice(0, 420)}`);

  check(proseWords >= 1_000, `the article is a real length (${String(proseWords)} words)`);
  check(headings.length >= 5, "it has the sections a post needs");
  check(steps >= 6, "every recipe step got its own heading");
  check(
    emojiHeadings / Math.max(1, headings.length) >= 0.6,
    "the emoji-led H2 pattern is there",
  );
  check(emDashes === 0, "no em dashes survived");
  check(!/!\[/.test(html), "no markdown image placeholders");
  check(!/\[(?:insert|todo|tbd)/i.test(html), "no placeholder tokens");
  check(!/\]\(/.test(text), "no raw markdown links in the prose");
  check((article.title ?? "").trim() !== "", "the post has a title");
  check((article.editorial?.seoDescription ?? "").trim() !== "", "it has a meta description");
  check((article.editorial?.slug ?? "").trim() !== "", "it has a slug");

  const card = article.recipeCard ?? {};
  const expectedIngredients = DISH === "stroganoff" ? 15 : 13;
  const expectedSteps = DISH === "stroganoff" ? 9 : 8;
  check(
    (card.ingredients ?? []).length === expectedIngredients,
    `the recipe card carries all ${String(expectedIngredients)} pasted ingredients (${String((card.ingredients ?? []).length)})`,
  );
  check(
    (card.steps ?? []).length === expectedSteps,
    `and all ${String(expectedSteps)} pasted steps (${String((card.steps ?? []).length)})`,
  );
  if (DISH === "stroganoff") {
    check(
      (card.ingredients ?? []).some((i) => /vegan sour cream/i.test(i)),
      "quantities are the author's own (vegan sour cream survived)",
    );
    const lower = text.toLowerCase();
    check(!html.includes("<<<"), "no pipeline markers in the finished HTML");
    check(!/coconut milk|white wine/i.test(lower), "no coconut milk or white wine leaked in");
    check(!/berlin|portland/i.test(lower), "no invented tester geography");
    check(
      !/like a warm hug|cozy bowl|feel good about the planet|pause briefly to admire/i.test(lower),
      "the named generic AI metaphors are gone",
    );
    check(!/masa harina|tamale pie/i.test(lower), "Tamale Pie facts did not leak into this recipe");
  } else {
    check(
      (card.ingredients ?? []).some((i) => i.includes("13.5 ounces")),
      "quantities are the author's own, unrounded",
    );
  }

  /* -------------------------------------------------------------- */
  console.log("\nCost");

  const diag = await (await api(`/api/draft-jobs/${jobId}/diagnostics`)).json();
  console.log(`  AI calls        ${String(diag.job.aiCalls)}`);
  console.log(`  input tokens    ${String(diag.job.inputTokens)}`);
  console.log(`  output tokens   ${String(diag.job.outputTokens)}`);
  console.log(`  retries         ${String(diag.job.retries)}`);
  console.log(
    `  elapsed         ${diag.job.elapsedMs === null ? "?" : `${String(Math.round(diag.job.elapsedMs / 1000))}s`}`,
  );
  console.log("  per stage:");
  for (const s of diag.stages) {
    if (s.status === "pending") continue;
    console.log(
      `    ${s.name.padEnd(16)} ${s.status.padEnd(10)} ${String(s.durationMs).padStart(6)}ms  ${String(
        s.inputTokens + s.outputTokens,
      ).padStart(6)} tok${s.attempt > 1 ? `  (attempt ${String(s.attempt)})` : ""}`,
    );
  }
  console.log("  provenance:");
  for (const p of diag.provenance) console.log(`    ${p.label}: ${p.status} — ${p.detail}`);
  if (diag.style.length > 0) {
    console.log("  style findings:");
    for (const f of diag.style) console.log(`    ${f.rule}: ${f.detail} (${String(f.count)})`);
  }
  if (diag.quality && !diag.quality.ok) {
    console.log("  quality warnings:");
    for (const i of diag.quality.issues) console.log(`    ${i.code}: ${i.message}`);
  }

  check(
    diag.job.aiCalls > 0 && diag.job.aiCalls <= 20,
    `the whole article cost ${String(diag.job.aiCalls)} model calls`,
  );
  /*
   * The pacing claim, stated as what it actually means. A stage's total now
   * spans every call it made across several invocations, so a large number
   * there is expected; what must not happen is the provider refusing a call
   * because the pipeline outran its allowance.
   */
  check(
    diag.stages.every((s) => s.errorCode !== "ai_rate_limit"),
    "no stage was ever refused for outrunning the per-minute allowance",
  );
  check(diag.job.retries === 0, "and nothing had to be retried");

  if (!KEEP) {
    await prisma.article.delete({ where: { id: articleId } });
    console.log("\n  (test article deleted — pass --keep to inspect it)");
  } else {
    console.log(`\n  kept: ${BASE}/content-assistant/${articleId}`);
  }
}

try {
  await main();
} catch (err) {
  console.error("\n" + String(err?.stack ?? err));
  failures += 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}

console.log(
  failures === 0 ? "\nLive end-to-end draft passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
