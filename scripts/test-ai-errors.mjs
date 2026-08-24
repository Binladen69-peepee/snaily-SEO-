/**
 * How the provider layer reports failure.
 *
 * Every case here has cost this project real time. A decommissioned model was
 * reported as a generic 502; a per-minute token cap was reported as "request
 * too large", which sent an operator off to shorten a draft that was never the
 * problem; a daily quota and a five-second burst cap arrived as the same 429
 * with opposite correct responses. The staged pipeline now makes decisions
 * from these classifications, so getting one wrong means retrying something
 * that can never succeed, or giving up on something that would have worked.
 *
 * No network: fetch is replaced with a stub that returns whatever the provider
 * actually returned when each of these happened.
 *
 *   node scripts/test-ai-errors.mjs
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
const out = mkdtempSync(join(ROOT, ".aitest-"));

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
    files: [join(ROOT, "lib/ai.ts")],
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

process.env.GROQ_API_KEY = "gsk_test_key_not_real";

const ai = await import(pathToFileURL(join(out, "lib/ai.js")).href);

/** Replies with a canned provider response. */
function stub(status, body, headers = {}) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
}

async function failure() {
  try {
    await ai.completeDetailed({ system: "s", user: "u", maxTokens: 100 });
    return null;
  } catch (err) {
    return err;
  }
}

try {
  console.log("\nRate limiting");

  stub(
    429,
    { error: { message: "Rate limit reached for model `openai/gpt-oss-120b`" } },
    { "retry-after": "7" },
  );
  let err = await failure();
  check(err instanceof ai.AiRateLimit, "a 429 is a rate limit, not a model error");
  check(err.retryable === true, "a burst cap is retryable");
  check(err.daily === false, "a burst cap is not a daily quota");
  check(err.retryAfterMs >= 7_000, "the provider's own wait is honoured");
  check(err.code === "ai_rate_limit", "the code is stable for the failure UI");

  stub(429, {
    error: {
      message:
        "Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 100000, Used 100000. Please try again in 1h56m6.432s.",
    },
  });
  err = await failure();
  check(err instanceof ai.AiRateLimit, "an exhausted daily allowance is a rate limit");
  check(err.daily === true, "it is recognised as a daily quota");
  check(err.retryable === false, "a daily quota is not worth retrying");
  check(err.code === "ai_daily_quota", "it gets its own code");
  check(
    err.message.includes("1h56m"),
    "the reset estimate reaches the operator instead of a billing pitch",
  );

  stub(413, {
    error: {
      message:
        "Request too large for model `openai/gpt-oss-120b` in organization org_x on tokens per minute (TPM): Limit 8000, Requested 9000.",
    },
  });
  err = await failure();
  check(
    err instanceof ai.AiRateLimit,
    "'request too large' on a TPM limit is reported as what it is: no tokens left this minute",
  );
  check(err.retryable === true, "which means waiting is the right answer");
  check(
    !err.message.toLowerCase().includes("too large"),
    "the misleading wording is not passed on to the operator",
  );

  console.log("\nModel and key");

  stub(404, {
    error: {
      message:
        "The model `llama-3.3-70b-versatile` has been decommissioned and is no longer supported.",
    },
  });
  err = await failure();
  check(err instanceof ai.AiModelUnavailable, "a decommissioned model has its own class");
  check(err.retryable === false, "retrying a retired model is pointless");
  check(err.configurable === true, "the operator can fix it, and is told so");
  check(err.message.includes("GROK_MODEL"), "the message names the setting to change");

  stub(401, { error: { message: "Invalid API Key" } });
  err = await failure();
  check(err instanceof ai.AiError, "a rejected key is an error");
  check(err.retryable === false, "a rejected key is never retried");
  check(err.configurable === true, "and is flagged as configuration");

  console.log("\nReasoning models");

  stub(200, {
    choices: [
      {
        message: { content: "", reasoning: "Thinking about this at length…" },
        finish_reason: "length",
      },
    ],
    usage: { prompt_tokens: 900, completion_tokens: 700 },
  });
  err = await failure();
  check(
    err instanceof ai.AiTruncated,
    "a reasoning model that spent its whole budget thinking is reported as truncated",
  );
  check(err.retryable === true, "and is worth retrying with more room");
  check(
    err.message.includes("AI_REASONING_EFFORT"),
    "the message names the setting that actually fixes it",
  );
  check(
    !err.message.includes("rephrasing"),
    "it no longer tells the operator to rephrase a prompt that was fine",
  );

  stub(200, {
    choices: [{ message: { content: "Half a sen" }, finish_reason: "length" }],
  });
  err = await failure();
  check(
    err instanceof ai.AiTruncated,
    "a reply cut off mid-sentence is rejected rather than saved as a section",
  );

  check(ai.isReasoningModel("openai/gpt-oss-120b"), "gpt-oss is known to reason");
  check(
    !ai.isReasoningModel("llama-3.1-8b-instant"),
    "llama is not, so it is never sent the parameter",
  );

  let sentBody = null;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  await ai.completeDetailed({ system: "s", user: "u", maxTokens: 100 });
  check(
    sentBody.reasoning_effort === "low",
    "reasoning effort is dialled down for a reasoning model",
  );

  await ai.completeDetailed({
    system: "s",
    user: "u",
    maxTokens: 100,
    model: "llama-3.1-8b-instant",
  });
  check(
    sentBody.reasoning_effort === undefined,
    "and omitted for a model that would reject the parameter outright",
  );

  console.log("\nNetwork");

  globalThis.fetch = async () => {
    throw new Error("socket hang up");
  };
  err = await failure();
  check(err instanceof ai.AiUnreachable, "a dropped connection is its own class");
  check(err.retryable === true, "and is worth another go");

  console.log("\nUsage accounting");

  stub(200, {
    choices: [{ message: { content: "Some prose." } }],
    usage: { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 },
  });
  let ok = await ai.completeDetailed({ system: "s", user: "u", maxTokens: 100 });
  check(ok.usage.input === 1234, "reported prompt tokens are used as-is");
  check(ok.usage.output === 567, "reported completion tokens are used as-is");
  check(ok.usage.measured === true, "reported usage is marked as measured");
  check(ok.model === "openai/gpt-oss-120b", "the model that answered is recorded");

  stub(200, { choices: [{ message: { content: "Some prose." } }] });
  ok = await ai.completeDetailed({ system: "s", user: "u", maxTokens: 100 });
  check(ok.usage.measured === false, "an estimate is marked as an estimate");
  check(ok.usage.input > 0, "and is still counted rather than dropped");

  console.log("\nRetry policy");

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
      status: 429,
      headers: { "retry-after": "1" },
    });
  };

  calls = 0;
  await failure();
  check(
    calls === 1,
    "staged work does not sleep inside the HTTP call - the job owns the schedule",
  );

  calls = 0;
  try {
    await ai.completeDetailed({
      system: "s",
      user: "u",
      maxTokens: 100,
      retryOnRateLimit: true,
    });
  } catch {
    /* still fails after its one retry */
  }
  check(calls === 2, "the legacy path still gets exactly one wait-and-retry");
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(
  failures === 0 ? "\nAll provider error checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
