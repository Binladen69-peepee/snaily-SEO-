/**
 * DataForSEO adapter unit tests (mocked fetch — no live credentials).
 *
 *   npm run test:dataforseo
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".dfstest-"));

const SOURCES = [
  "lib/dataforseo/config.ts",
  "lib/dataforseo/errors.ts",
  "lib/dataforseo/client.ts",
  "lib/dataforseo/backlinks.ts",
  "lib/dataforseo/health.ts",
  "lib/dataforseo/mapping.ts",
];

const tsconfig = join(out, "tsconfig.json");
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: false,
      skipLibCheck: true,
      types: ["node"],
      typeRoots: [join(ROOT, "node_modules/@types")],
      baseUrl: ROOT,
      paths: { "@/*": ["./*"] },
      outDir: out,
      rootDir: ROOT,
    },
    files: SOURCES.map((s) => join(ROOT, s)),
  }),
);

try {
  execFileSync("npx", ["tsc", "-p", `"${tsconfig}"`], { stdio: "pipe", shell: true });
} catch (err) {
  console.error("tsc failed:\n" + String(err.stdout ?? err.stderr ?? err));
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

const rewrite = (file) => {
  const p = join(out, file.replace(/\.ts$/, ".js"));
  const src = readFileSync(p, "utf8");
  const depth = file.split("/").length - 1;
  const prefix = "../".repeat(depth) || "./";
  writeFileSync(
    p,
    src.replace(/from "@\/(.*?)"/g, (_m, rest) => `from "${prefix}${rest}.js"`),
  );
  return p;
};

function rewriteAll(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rewriteAll(path);
    else if (entry.name.endsWith(".js")) {
      const rel = relative(out, path).replace(/\\/g, "/");
      const src = readFileSync(path, "utf8");
      if (!src.includes('"@/')) continue;
      const depth = rel.split("/").length - 1;
      const prefix = "../".repeat(depth) || "./";
      writeFileSync(
        path,
        src.replace(/from "@\/(.*?)"/g, (_m, rest) => `from "${prefix}${rest}.js"`),
      );
    }
  }
}

SOURCES.forEach(rewrite);
rewriteAll(out);

const config = await import(pathToFileURL(join(out, "lib/dataforseo/config.js")).href);
const errors = await import(pathToFileURL(join(out, "lib/dataforseo/errors.js")).href);
const client = await import(pathToFileURL(join(out, "lib/dataforseo/client.js")).href);
const backlinks = await import(pathToFileURL(join(out, "lib/dataforseo/backlinks.js")).href);
const health = await import(pathToFileURL(join(out, "lib/dataforseo/health.js")).href);
const mapping = await import(pathToFileURL(join(out, "lib/dataforseo/mapping.js")).href);

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

console.log("DataForSEO adapter");

withEnv(
  {
    DATAFORSEO_LOGIN: undefined,
    DATAFORSEO_PASSWORD: undefined,
    DFS_LOGIN: undefined,
    DFS_PASSWORD: undefined,
    DATAFORSEO_API_LOGIN: undefined,
    DATAFORSEO_API_PASSWORD: undefined,
  },
  () => {
    check("missing credentials → not configured", config.dataForSeoConfigured() === false);
    check("readCredentials null", config.readCredentials() === null);
    let threw = false;
    try {
      config.requireCredentials();
    } catch (e) {
      threw = e.code === "dataforseo_not_configured";
    }
    check("requireCredentials throws typed config error", threw);
  },
);

withEnv(
  { DATAFORSEO_LOGIN: "user@example.com", DATAFORSEO_PASSWORD: "secret-pass" },
  () => {
    check("credentials present → configured", config.dataForSeoConfigured() === true);
    const c = config.readCredentials();
    check("login read", c?.login === "user@example.com");
    check("password read", c?.password === "secret-pass");
  },
);

{
  const h = await withEnv(
    {
      DATAFORSEO_LOGIN: undefined,
      DATAFORSEO_PASSWORD: undefined,
      DFS_LOGIN: undefined,
      DFS_PASSWORD: undefined,
      DATAFORSEO_API_LOGIN: undefined,
      DATAFORSEO_API_PASSWORD: undefined,
    },
    () =>
      health.checkDataForSeoHealth({
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      }),
  );
  check("health not_configured", h.status === "not_configured" && h.authenticated === false);
}

{
  const h = await withEnv(
    { DATAFORSEO_LOGIN: "user@example.com", DATAFORSEO_PASSWORD: "secret-pass" },
    () =>
      health.checkDataForSeoHealth({
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              status_code: 20000,
              status_message: "Ok.",
              tasks: [{ status_code: 20000, result: [{ login: "user@example.com" }] }],
            }),
            { status: 200 },
          ),
      }),
  );
  const json = JSON.stringify(h);
  check("health authenticated", h.status === "authenticated" && h.authenticated === true);
  check("login redacted", h.loginHint === "***@example.com");
  check("password never in health payload", !json.includes("secret-pass"));
  check("full login never in health payload", !json.includes("user@example.com"));
}

{
  const h = await withEnv(
    { DATAFORSEO_LOGIN: "bad", DATAFORSEO_PASSWORD: "bad" },
    () =>
      health.checkDataForSeoHealth({
        fetchImpl: async () => new Response("Unauthorized", { status: 401 }),
      }),
  );
  check("health unauthorized", h.status === "unauthorized");
}

{
  const bal = errors.errorFromStatus(40200, "Payment Required");
  const rate = errors.errorFromStatus(42900, "Too Many Requests");
  check("insufficient_balance mapping", bal.code === "insufficient_balance");
  check("rate_limited mapping", rate.code === "rate_limited");
}

{
  /*
   * 40101 is "Internal SE Server Error", which the live API returns for a deep
   * request on a query with too few real results. It was mapped to
   * "unauthorized", so a thin keyword told the author their DataForSEO login
   * was rejected and made the cache layer re-throw instead of soft-failing.
   */
  const auth = errors.errorFromStatus(40100, "Auth error.");
  const se1 = errors.errorFromStatus(40101, "Internal SE Server Error.");
  const se2 = errors.errorFromStatus(40102, "Internal SE Server Error.");
  check("40100 is still an auth failure", auth.code === "unauthorized");
  check("40101 is not an auth failure", se1.code === "unavailable");
  check("40102 is not an auth failure", se2.code === "unavailable");
  check("40101 is retryable", se1.retryAfterMs !== null);
  check(
    "40101 keeps the provider's real message",
    se1.message.includes("Internal SE Server Error"),
  );
}

{
  // Depth drives how long DataForSEO needs: measured ~2s at depth 10 and
  // 35-45s at depth 100, so a flat 45s timed the rank tracker out.
  const src = readFileSync(join(ROOT, "lib/dataforseo/serp.ts"), "utf8");
  check(
    "organic SERP timeout scales with depth",
    /function serpTimeoutMs\(/.test(src) && /timeoutMs: serpTimeoutMs\(depth\)/.test(src),
  );
}

check(
  "normalizeTarget strips www + path",
  backlinks.normalizeTarget("https://www.CinnamonSnail.com/recipes/") === "cinnamonsnail.com",
);

{
  const { rows, cost } = await withEnv(
    { DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" },
    () =>
      backlinks.fetchBulkRanks(["wikipedia.org", "cinnamonsnail.com"], {
        credentials: { login: "u", password: "p" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              status_code: 20000,
              cost: 0.02,
              tasks: [
                {
                  status_code: 20000,
                  cost: 0.02,
                  /*
                   * The shape the live API really returns: rows nested under
                   * result[0].items. This fixture used to be flat, which is
                   * why the suite passed while every real rank came back null.
                   */
                  result: [
                    {
                      items_count: 2,
                      items: [
                        { target: "wikipedia.org", rank: 94 },
                        { target: "cinnamonsnail.com", rank: 28 },
                      ],
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
      }),
  );
  const wiki = rows.find((r) => r.target === "wikipedia.org");
  const snail = rows.find((r) => r.target === "cinnamonsnail.com");
  check("bulk ranks cost", cost === 0.02);
  check("wikipedia rank", wiki?.rank === 94);
  check("cinnamonsnail rank", snail?.rank === 28);
  check(
    "stronger domain ranks higher (mock ordering)",
    (wiki?.rank ?? 0) > (snail?.rank ?? 100),
  );
  check(
    "no rank is null when the API answered",
    rows.every((r) => r.rank !== null),
  );
}

{
  // A flat result[] must still parse, so the parser cannot regress either way.
  const { rows } = await withEnv(
    { DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" },
    () =>
      backlinks.fetchBulkRanks(["example.com"], {
        credentials: { login: "u", password: "p" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              status_code: 20000,
              cost: 0.01,
              tasks: [
                {
                  status_code: 20000,
                  cost: 0.01,
                  result: [{ target: "example.com", rank: 55 }],
                },
              ],
            }),
            { status: 200 },
          ),
      }),
  );
  check("a flat result row still parses", rows[0]?.rank === 55);
}

{
  const { rows, cost } = await withEnv(
    { DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" },
    () =>
      backlinks.fetchBulkPagesSummary(
        ["https://cinnamonsnail.com/", "cinnamonsnail.com"],
        {
          credentials: { login: "u", password: "p" },
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                status_code: 20000,
                cost: 0.02,
                tasks: [
                  {
                    status_code: 20000,
                    cost: 0.02,
                    result: [
                      {
                        items: [
                          {
                            url: "https://cinnamonsnail.com/",
                            rank: 22,
                            main_domain_rank: 39,
                            backlinks: 120,
                            referring_domains: 40,
                            backlinks_spam_score: 5,
                          },
                          {
                            url: "cinnamonsnail.com",
                            rank: 39,
                            main_domain_rank: 39,
                            backlinks: 800,
                            referring_domains: 210,
                            backlinks_spam_score: 4,
                          },
                        ],
                      },
                    ],
                  },
                ],
              }),
              { status: 200 },
            ),
        },
      ),
  );
  check("bulk pages summary cost", cost === 0.02);
  check(
    "page backlinks from bulk_pages_summary",
    rows.some((r) => r.backlinks === 120),
  );
  check(
    "domain referring_domains from bulk_pages_summary",
    rows.some((r) => r.referringDomains === 210),
  );
}

{
  let code = "";
  await withEnv({ DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" }, async () => {
    try {
      await backlinks.fetchBacklinkSummary("unknown.invalid", {
        credentials: { login: "u", password: "p" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              status_code: 20000,
              tasks: [{ status_code: 20000, result: [] }],
            }),
            { status: 200 },
          ),
      });
    } catch (err) {
      code = err.code;
    }
  });
  check("empty summary → empty error", code === "empty");
}

{
  let code = "";
  await withEnv({ DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" }, async () => {
    try {
      await client.dataForSeoPost(
        "/v3/backlinks/bulk_ranks/live",
        [{ targets: ["a.com"] }],
        {
          timeoutMs: 20,
          credentials: { login: "u", password: "p" },
          fetchImpl: async (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () => {
                const e = new Error("aborted");
                e.name = "AbortError";
                reject(e);
              });
            }),
        },
      );
    } catch (err) {
      code = err.code;
    }
  });
  check("timeout typed error", code === "timeout");
}

check(
  "replacement is not Moz",
  mapping.AUTHORITY_REPLACEMENT_REPORT.equivalentToMoz === false,
);
check(
  "field map never claims Moz",
  mapping.DATAFORSEO_FIELD_MAP.every((row) => row.mozEquivalent === false),
);

rmSync(out, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${String(failures)} DataForSEO test(s) failed.`);
  process.exit(1);
}
console.log("\nAll DataForSEO unit tests passed.");
