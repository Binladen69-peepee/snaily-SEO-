/**
 * Stopping and restarting a generation, against a running server.
 *
 * The controls matter more than they look. "Stop" that throws away four
 * finished sections is not a stop, it is a delete; "Retry" that re-runs the
 * whole article bills the client twice for one draft. Both are easy to get
 * wrong in a way nothing else notices, so they are exercised here on a real
 * job: cancelled halfway, checked for what survived, then resumed and checked
 * that it carried on rather than started over.
 *
 *   npm start
 *   node --env-file=.env scripts/test-draft-control.mjs
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

const RECIPE = `Ingredients
1 cup (240 ml) full fat coconut milk
2 tablespoons red curry paste
1 pound (450 g) firm tofu, cubed
1 tablespoon soy sauce
1 teaspoon coconut sugar

Instructions
1. Warm the coconut milk in a wide pan over medium heat until it steams.
2. Whisk in the red curry paste and cook for 3 minutes.
3. Add the tofu and simmer for 12 minutes, turning it once.
4. Finish with the soy sauce and coconut sugar, then serve.`;

let articleId = null;

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, userId: true, name: true, _count: { select: { wpPosts: true } } },
  });
  const project = [...projects].sort(
    (a, b) => b._count.wpPosts - a._count.wpPosts,
  )[0];
  if (!project) throw new Error("No project in the database.");

  const user = await prisma.user.findUnique({
    where: { id: project.userId },
    select: { id: true, email: true, name: true },
  });

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

  const created = await (
    await api("/api/articles", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        title: "Vegan Red Curry Tofu",
        keyword: "vegan red curry tofu",
        mode: "drafter",
        recipe: RECIPE,
      }),
    })
  ).json();
  articleId = created.id;

  /* -------------------------------------------------------------- */
  console.log("\nAuthorization");

  const noCookie = await fetch(`${BASE}/api/articles/${articleId}/draft-job`, {
    method: "POST",
  });
  check(noCookie.status === 401, "drafting requires a session");

  const started = await (
    await api(`/api/articles/${articleId}/draft-job`, { method: "POST" })
  ).json();
  const jobId = started.job.id;

  const strangerToken = await new SignJWT({
    userId: "not-the-owner",
    email: "nobody@example.com",
    name: "Nobody",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  const stranger = await fetch(`${BASE}/api/draft-jobs/${jobId}`, {
    headers: { cookie: `session=${strangerToken}` },
  });
  check(stranger.status === 404, "another signed-in user cannot read this job");

  const strangerCancel = await fetch(`${BASE}/api/draft-jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { cookie: `session=${strangerToken}` },
  });
  check(strangerCancel.status === 404, "and cannot cancel it");

  const unsignedRun = await fetch(`${BASE}/api/draft-jobs/${jobId}/run`, {
    method: "POST",
    headers: { "x-job-token": "0".repeat(64) },
  });
  check(unsignedRun.status === 401, "the worker endpoint rejects a forged token");

  const noToken = await fetch(`${BASE}/api/draft-jobs/${jobId}/run`, { method: "POST" });
  check(noToken.status === 401, "and refuses a request with no token at all");

  const cronOpen = await fetch(`${BASE}/api/cron/draft-jobs`);
  check(
    cronOpen.status === 401 || cronOpen.status === 503,
    "the cron sweeper is not open to the internet",
  );

  /* -------------------------------------------------------------- */
  console.log("\nCancel");

  // Let it get properly under way first, so there is real work to preserve.
  let job = started.job;
  for (let i = 0; i < 40 && job.done < 3; i += 1) {
    await new Promise((r) => setTimeout(r, 3_000));
    job = (await (await api(`/api/draft-jobs/${jobId}`)).json()).job;
  }
  check(job.done >= 3, `some stages finished before cancelling (${job.done})`);

  const cancelled = await (
    await api(`/api/draft-jobs/${jobId}/cancel`, { method: "POST" })
  ).json();
  check(cancelled.cancelled === true, "the cancel is accepted");

  for (let i = 0; i < 40 && job.status !== "cancelled"; i += 1) {
    await new Promise((r) => setTimeout(r, 3_000));
    job = (await (await api(`/api/draft-jobs/${jobId}`)).json()).job;
  }
  check(job.status === "cancelled", `the job stops (${job.status})`);

  const doneAtCancel = job.done;
  const stateAfterCancel = await prisma.draftJob.findUnique({
    where: { id: jobId },
    select: { state: true },
  });
  const sectionsKept = Object.keys(stateAfterCancel.state.sections ?? {}).length;
  check(
    (stateAfterCancel.state.research?.internalPosts ?? []).length > 0,
    "the research it had already done is still there",
  );
  check(
    stateAfterCancel.state.outline !== undefined,
    "and so is the outline it built",
  );
  console.log(`  (kept ${String(doneAtCancel)} stages, ${String(sectionsKept)} sections)`);

  /* -------------------------------------------------------------- */
  console.log("\nResume");

  const resumed = await (
    await api(`/api/draft-jobs/${jobId}/retry`, {
      method: "POST",
      body: JSON.stringify({}),
    })
  ).json();
  check(resumed.resumed === true, "a stopped job can be picked up again");

  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 3_000));
    job = (await (await api(`/api/draft-jobs/${jobId}`)).json()).job;
    if (["completed", "failed", "cancelled"].includes(job.status)) break;
  }
  check(job.status === "completed", `and runs to the end (${job.status})`);
  check(
    job.done >= doneAtCancel,
    "without losing any stage that had already finished",
  );

  const stages = await prisma.draftJobStage.findMany({
    where: { draftJobId: jobId },
    select: { name: true, attempt: true, status: true },
  });
  const reRun = stages.filter((s) => s.attempt > 1).map((s) => s.name);
  check(
    reRun.length <= 1,
    `resuming re-ran at most the interrupted stage (${reRun.join(", ") || "none"})`,
  );

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { content: true },
  });
  const words = article.content.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  check(words > 800, `the resumed article is complete (${String(words)} words)`);

  const diag = await (await api(`/api/draft-jobs/${jobId}/diagnostics`)).json();
  console.log(
    `  cost across the interruption: ${String(diag.job.aiCalls)} calls, ${String(
      diag.job.inputTokens + diag.job.outputTokens,
    )} tokens`,
  );
}

try {
  await main();
} catch (err) {
  console.error("\n" + String(err?.stack ?? err));
  failures += 1;
} finally {
  if (articleId !== null) {
    await prisma.article.delete({ where: { id: articleId } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
}

console.log(
  failures === 0 ? "\nCancel and resume behave.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
