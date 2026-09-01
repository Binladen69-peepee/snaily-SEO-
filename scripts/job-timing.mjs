/**
 * Where a Drafter run actually spends its time.
 *
 * "It takes fifteen minutes" is not a finding. This prints the per-stage
 * breakdown that turns it into one: how long each stage held the worker, how
 * much of the wall clock nobody was working at all, how many tokens went out
 * as prompt versus came back as writing, and how much of the run was spent
 * waiting for the provider's per-minute allowance to refill.
 *
 * The last two are the ones that matter. A pipeline whose input tokens dwarf
 * its output is paying to re-send context, and at a fixed tokens-per-minute
 * ceiling that cost is measured in minutes of waiting, not in money.
 *
 *   node --env-file=.env.local scripts/job-timing.mjs [jobId|articleId]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const wanted = process.argv[2];

let job = null;
if (wanted) {
  job =
    (await prisma.draftJob.findUnique({ where: { id: wanted } })) ??
    (await prisma.draftJob.findFirst({
      where: { articleId: wanted },
      orderBy: { createdAt: "desc" },
    }));
} else {
  job = await prisma.draftJob.findFirst({ orderBy: { createdAt: "desc" } });
}
if (job === null) {
  console.log("no job found");
  process.exit(1);
}

const article = await prisma.article.findUnique({
  where: { id: job.articleId },
  select: { title: true, content: true },
});

const stages = await prisma.draftJobStage.findMany({
  where: { draftJobId: job.id },
  orderBy: { ordinal: "asc" },
});
await prisma.$disconnect();

const secs = (ms) => (ms / 1000).toFixed(1);

console.log(`\nArticle : ${article?.title ?? "(gone)"}`);
console.log(`Job     : ${job.id}`);
console.log(`Status  : ${job.status}${job.stage ? ` (${job.stage})` : ""}`);

const started = stages
  .filter((s) => s.startedAt)
  .reduce((a, s) => (a === null || s.startedAt < a ? s.startedAt : a), null);
const ended = stages
  .filter((s) => s.completedAt)
  .reduce((a, s) => (a === null || s.completedAt > a ? s.completedAt : a), null);

console.log("\nstage             status      calls  attempt   in-tok  out-tok   time");
console.log("-".repeat(74));

let inTok = 0;
let outTok = 0;
let work = 0;

for (const s of stages) {
  inTok += s.inputTokens;
  outTok += s.outputTokens;
  work += s.durationMs;
  if (s.status === "pending") continue;
  // A stage with tokens but no model made no call of its own.
  const calls = s.model === "" ? 0 : "·";
  console.log(
    `${s.name.padEnd(17)} ${s.status.padEnd(11)} ${String(calls).padStart(5)} ${String(s.attempt).padStart(8)} ${String(s.inputTokens).padStart(8)} ${String(s.outputTokens).padStart(8)} ${secs(s.durationMs).padStart(6)}s`,
  );
}

console.log("-".repeat(74));

const wall = started && ended ? ended - started : 0;
const idle = Math.max(0, wall - work);

console.log(`\nWorking          ${secs(work).padStart(8)}s`);
console.log(`Waiting          ${secs(idle).padStart(8)}s   ${wall > 0 ? `${((idle / wall) * 100).toFixed(0)}% of the run` : ""}`);
console.log(`Total            ${secs(wall).padStart(8)}s`);

const total = inTok + outTok;
console.log(`\nPrompt tokens    ${String(inTok).padStart(8)}   ${total > 0 ? `${((inTok / total) * 100).toFixed(0)}% of everything spent` : ""}`);
console.log(`Written tokens   ${String(outTok).padStart(8)}`);
console.log(`Total tokens     ${String(total).padStart(8)}`);

/*
 * The floor nothing can go below. Groq meters 8,000 tokens a minute on this
 * account, and the app keeps 90% of that; a run needing more than one minute's
 * worth cannot finish faster than the allowance refills, whatever else is
 * fixed. When this number is close to the total, the fix is fewer tokens —
 * not more parallelism.
 */
const BUDGET = Number(process.env.AI_TPM_BUDGET ?? 7600) * 0.9;
console.log(
  `\nAllowance floor  ${secs((total / BUDGET) * 60_000).padStart(8)}s   (${total} tokens at ${Math.round(BUDGET)}/min)`,
);

const retried = stages.filter((s) => s.attempt > 1);
if (retried.length > 0) {
  console.log(`\nRetried stages   ${retried.map((s) => `${s.name} ×${String(s.attempt)}`).join(", ")}`);
}

const words = (article?.content ?? "")
  .replace(/<[^>]+>/g, " ")
  .split(/\s+/)
  .filter(Boolean).length;
if (words > 0) console.log(`\nArticle          ${String(words)} words`);
