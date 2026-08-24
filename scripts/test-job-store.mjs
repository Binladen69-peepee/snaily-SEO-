/**
 * Job durability, against the real database.
 *
 * Leasing, idempotency and stale recovery cannot be tested with a fake: they
 * are claims about what Postgres does when two writers race, and an in-memory
 * stand-in would happily agree with whatever the code already believes. So this
 * runs against the actual database, on a throwaway article it deletes
 * afterwards, and every job row goes with it on cascade.
 *
 *   node --env-file=.env.local scripts/test-job-store.mjs
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".jobstore-"));

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: false,
      skipLibCheck: true,
      types: ["node"],
      baseUrl: ROOT,
      paths: { "@/*": ["./*"] },
      outDir: out,
      rootDir: ROOT,
    },
    files: [join(ROOT, "lib/jobs/store.ts")],
  }),
);

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

try {
  execFileSync("npx", ["tsc", "-p", `"${join(out, "tsconfig.json")}"`], {
    stdio: "pipe",
    shell: true,
  });
} catch (err) {
  console.error("tsc failed:\n" + String(err.stdout ?? err));
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

const emitted = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) emitted.push(full);
  }
};
walk(out);

for (const file of emitted) {
  const rel = relative(out, file).split(sep).join("/");
  const prefix = "../".repeat(rel.split("/").length - 1) || "./";
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      /from "@\/(.*?)"/g,
      (_m, r) => `from "${prefix}${r}.js"`,
    ),
  );
}

const store = await import(
  pathToFileURL(join(out, "lib/jobs/store.js")).href
);
const { prisma } = await import(
  pathToFileURL(join(out, "lib/db.js")).href
);

let articleId = null;

try {
  const project = await prisma.project.findFirst({
    select: { id: true, userId: true },
  });
  if (project === null) {
    console.error("No project in the database to test against.");
    process.exit(1);
  }

  const article = await prisma.article.create({
    data: {
      userId: project.userId,
      projectId: project.id,
      title: "Job store test article",
      keyword: "job store test",
      mode: "drafter",
      recipe: "Ingredients\n1 cup water\n\nInstructions\n1. Boil it.",
      status: "draft",
    },
    select: { id: true },
  });
  articleId = article.id;

  /* ---------------------------------------------------------------- */
  console.log("\nJob creation");

  const first = await store.createOrResumeJob({
    userId: project.userId,
    projectId: project.id,
    articleId,
  });
  check(first.created === true, "a new article gets a new job");

  const stages = await store.loadStages(first.job.id);
  check(stages.length === 16, "all sixteen stages are created up front");
  check(
    stages.every((s) => s.status === "pending"),
    "every stage starts pending",
  );
  check(
    stages.map((s) => s.ordinal).join(",") === stages.map((_s, i) => i).join(","),
    "stage order is recorded, not inferred from insertion",
  );

  const second = await store.createOrResumeJob({
    userId: project.userId,
    projectId: project.id,
    articleId,
  });
  check(second.created === false, "a second click does not start a second job");
  check(second.job.id === first.job.id, "it resumes the live one");

  const jobId = first.job.id;

  /* ---------------------------------------------------------------- */
  console.log("\nAuthorization");

  check(
    (await store.findOwnedJob(jobId, project.userId)) !== null,
    "the owner can read their job",
  );
  check(
    (await store.findOwnedJob(jobId, "someone-elses-user-id")) === null,
    "another user cannot read it",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nWorker leasing");

  const claimed = await store.claimJob(jobId, "worker-a");
  check(claimed !== null, "the first worker takes the lease");

  const contender = await store.claimJob(jobId, "worker-b");
  check(contender === null, "a second worker is refused while the lease is live");

  const again = await store.claimJob(jobId, "worker-a");
  check(again !== null, "the holder can re-claim its own job");

  await store.saveState(jobId, "worker-a", { version: 1, titleAtStart: "held" });
  const held = await store.findJob(jobId);
  check(held.state.titleAtStart === "held", "the lease holder can write state");

  await store.saveState(jobId, "worker-b", { version: 1, titleAtStart: "stolen" });
  const notStolen = await store.findJob(jobId);
  check(
    notStolen.state.titleAtStart === "held",
    "a worker without the lease writes nothing",
  );

  // Expire the lease the way a dead function would: by not renewing it.
  await prisma.draftJob.update({
    where: { id: jobId },
    data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
  });

  check(
    (await store.staleJobs(20)).includes(jobId),
    "an expired lease shows up as stale work",
  );

  const reclaimed = await store.claimJob(jobId, "worker-c");
  check(reclaimed !== null, "another worker reclaims a job whose worker died");
  check(
    !(await store.staleJobs(20)).includes(jobId),
    "a reclaimed job is no longer stale",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nStage idempotency");

  const begun = await store.beginStage(jobId, "validate");
  check(begun.started === true && begun.attempt === 1, "first attempt is attempt 1");

  await store.recordAiCall(jobId, "validate", {
    input: 900,
    output: 300,
    provider: "groq",
    model: "openai/gpt-oss-120b",
  });
  await store.recordAiCall(jobId, "validate", {
    input: 400,
    output: 200,
    provider: "groq",
    model: "openai/gpt-oss-120b",
  });

  const committed = await store.commitStage(jobId, "validate", { steps: 1 }, 120);
  check(committed === true, "the stage commits");

  const duplicate = await store.commitStage(jobId, "validate", { steps: 999 }, 120);
  check(
    duplicate === false,
    "a duplicate commit is refused, so the first result stands",
  );

  const after = (await store.loadStages(jobId)).find((s) => s.name === "validate");
  check(after.output.steps === 1, "the original output survives the duplicate");

  const costed = await prisma.draftJobStage.findFirst({
    where: { draftJobId: jobId, name: "validate" },
    select: { inputTokens: true, outputTokens: true, model: true },
  });
  check(
    costed.inputTokens === 1_300 && costed.outputTokens === 500,
    "every call in a stage is counted, not just the last invocation's",
  );
  const jobTotals = await prisma.draftJob.findUnique({
    where: { id: jobId },
    select: { aiCalls: true, inputTokens: true, outputTokens: true },
  });
  check(
    jobTotals.aiCalls === 2 && jobTotals.inputTokens === 1_300,
    "and the job totals agree with the stage totals",
  );

  const reBegun = await store.beginStage(jobId, "validate");
  check(
    reBegun.started === false,
    "a retry of a completed stage does no work at all",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nPartial resume");

  await store.beginStage(jobId, "sections");
  await store.markStagePartial(jobId, "sections", "2/5");

  const stageRows = await store.loadStages(jobId);
  const partialRow = stageRows.find((s) => s.name === "sections");
  check(store.partialNote(partialRow.output) === "2/5", "progress is readable by the UI");

  const resumed = await store.beginStage(jobId, "sections");
  check(
    resumed.resumed === true && resumed.attempt === 1,
    "resuming a deliberate yield does not spend a retry",
  );

  await store.failStage(jobId, "sections", "ai_rate_limit", "out of tokens", 50);
  await store.resetStage(jobId, "sections");
  const retried = await store.beginStage(jobId, "sections");
  check(
    retried.attempt === 2,
    "an actual failure does spend a retry",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nSkip, cancel and finish");

  await store.beginStage(jobId, "affiliate-links");
  await store.skipStage(jobId, "affiliate-links", "no affiliate rows");
  const skipped = (await store.loadStages(jobId)).find(
    (s) => s.name === "affiliate-links",
  );
  check(skipped.status === "skipped", "a stage can be skipped");

  const view = store.toJobView(await store.findJob(jobId), await store.loadStages(jobId), () => "");
  check(view.done === 2, "a skipped stage counts as done in the progress total");
  check(view.total === 16, "the progress total is the real stage count");
  check(
    view.stages.every((s) => !("output" in s)),
    "the browser view carries no stage output",
  );

  check(
    (await store.requestCancel(jobId, project.userId)) === true,
    "the owner can request a cancel",
  );
  check(
    (await store.requestCancel(jobId, "someone-else")) === false,
    "another user cannot cancel it",
  );

  await store.finishJob(jobId, "worker-c", "completed");
  const finished = await store.findJob(jobId);
  check(finished.status === "completed", "the job finishes");
  check(finished.workerId === "", "the lease is released on finish");
  check(finished.finishedAt !== null, "the finish time is recorded");

  const fresh = await store.createOrResumeJob({
    userId: project.userId,
    projectId: project.id,
    articleId,
  });
  check(
    fresh.created === true && fresh.job.id !== jobId,
    "drafting again after completion starts a genuinely new job",
  );
} finally {
  if (articleId !== null) {
    await prisma.article.delete({ where: { id: articleId } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
  rmSync(out, { recursive: true, force: true });
}

console.log(
  failures === 0 ? "\nAll job store checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
