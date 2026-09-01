/**
 * Drive an existing draft job to completion against a running server.
 *
 * test-draft-live.mjs creates an article and watches one job; if the watcher
 * dies (a closed laptop, an interrupted session) the job is still there, and
 * the runner's poll-driven recovery means it only needs somebody to keep
 * asking. This does the asking, so an expensive half-finished generation is
 * resumed rather than paid for twice.
 *
 * The pipeline pauses itself on the provider's per-minute token allowance, so
 * long gaps between stages are normal and not a hang.
 *
 *   node --env-file=.env.local scripts/resume-draft-job.mjs <articleId>
 */
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const articleId = process.argv[2];
if (!articleId) {
  console.log("usage: resume-draft-job.mjs <articleId>");
  process.exit(1);
}

const prisma = new PrismaClient();
const article = await prisma.article.findUnique({
  where: { id: articleId },
  select: { id: true, title: true, userId: true },
});
if (!article) {
  console.log("no such article");
  process.exit(1);
}

const job = await prisma.draftJob.findFirst({
  where: { articleId },
  orderBy: { createdAt: "desc" },
  select: { id: true, status: true },
});
await prisma.$disconnect();

if (!job) {
  console.log("no job for that article");
  process.exit(1);
}

const token = await new SignJWT({ userId: article.userId })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("6h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

const headers = { cookie: `session=${token}`, "content-type": "application/json" };

console.log(`article ${article.id}`);
console.log(`job     ${job.id} (${job.status})`);
console.log(`title   ${article.title}\n`);

const started = Date.now();
const LIMIT_MS = 40 * 60 * 1000;
let lastLine = "";

for (;;) {
  if (Date.now() - started > LIMIT_MS) {
    console.log("\ngave up waiting");
    process.exit(1);
  }

  // Nudge the runner, then read where it is. Both are what the browser does.
  await fetch(`${BASE}/api/draft-jobs/${job.id}/run`, { method: "POST", headers }).catch(
    () => undefined,
  );

  const res = await fetch(`${BASE}/api/draft-jobs/${job.id}`, { headers });
  if (!res.ok) {
    console.log(`status ${String(res.status)}`);
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }

  const body = await res.json();
  const j = body.job ?? body;
  const line = `[${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s] ${String(j.done ?? j.completed ?? "?")}/${String(j.total ?? "?")} ${String(j.stage ?? j.currentStage ?? "")} ${String(j.status ?? "")}`;
  if (line.slice(8) !== lastLine.slice(8)) {
    console.log(line);
    lastLine = line;
  }

  if (j.status === "done" || j.status === "complete" || j.status === "completed") {
    console.log("\nfinished");
    break;
  }
  if (j.status === "failed" || j.status === "error") {
    console.log(`\nfailed: ${JSON.stringify(j.error ?? j.errorCode ?? "")}`);
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 6000));
}

const prisma2 = new PrismaClient();
const done = await prisma2.article.findUnique({
  where: { id: articleId },
  select: { content: true, phase: true, status: true },
});
await prisma2.$disconnect();

const html = done?.content ?? "";
console.log(`\nphase=${done?.phase} status=${done?.status} chars=${String(html.length)}`);
for (const [label, needle] of [
  ["you'll also love these", "also love these"],
  ["FSRI post IDs", "FSRI post IDs"],
  ["Recipe Card", "Recipe Card"],
  ["Yoast SEO", "Yoast SEO"],
]) {
  const at = html.indexOf(needle);
  console.log(`  ${at >= 0 ? "yes" : "NO "}  ${label}${at >= 0 ? `  @${String(at)}` : ""}`);
}
console.log(`\narticleId: ${articleId}`);
