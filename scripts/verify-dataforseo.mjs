/**
 * Live DataForSEO verification — auth, authority ranks, and SERP.
 *
 *   npm run verify:dataforseo
 *
 * Requires DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD.
 * Never prints credentials.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

const login = (process.env.DATAFORSEO_LOGIN ?? "").trim();
const password = (process.env.DATAFORSEO_PASSWORD ?? "").trim();

if (!login || !password) {
  console.log("BLOCKED  DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set.");
  console.log("         Required for live verification:");
  console.log("           DATAFORSEO_LOGIN");
  console.log("           DATAFORSEO_PASSWORD");
  console.log("         Set them in .env.local and Vercel Production, then re-run.");
  process.exit(1);
}

const TEST_KEYWORD = process.env.VERIFY_SERP_KEYWORD ?? "vegan italian sausage";
const TEST_COUNTRY = process.env.VERIFY_SERP_COUNTRY ?? "us";

const out = mkdtempSync(join(ROOT, ".dfsverify-"));
const SOURCES = [
  "lib/dataforseo/config.ts",
  "lib/dataforseo/errors.ts",
  "lib/dataforseo/client.ts",
  "lib/dataforseo/backlinks.ts",
  "lib/dataforseo/health.ts",
  "lib/dataforseo/locations.ts",
  "lib/dataforseo/serp.ts",
];

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
  execFileSync("npx", ["tsc", "-p", `"${join(out, "tsconfig.json")}"`], {
    stdio: "pipe",
    shell: true,
  });
} catch (err) {
  console.error("tsc failed:\n" + String(err.stdout ?? err.stderr ?? err));
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

for (const file of SOURCES) {
  const p = join(out, file.replace(/\.ts$/, ".js"));
  const depth = file.split("/").length - 1;
  const prefix = "../".repeat(depth) || "./";
  writeFileSync(
    p,
    readFileSync(p, "utf8").replace(
      /from "@\/(.*?)"/g,
      (_m, rest) => `from "${prefix}${rest}.js"`,
    ),
  );
}

const health = await import(pathToFileURL(join(out, "lib/dataforseo/health.js")).href);
const backlinks = await import(pathToFileURL(join(out, "lib/dataforseo/backlinks.js")).href);
const serp = await import(pathToFileURL(join(out, "lib/dataforseo/serp.js")).href);

console.log("=== 1. Authentication ===");
const h = await health.checkDataForSeoHealth();
console.log(`Status: ${h.status}`);
console.log(`Message: ${h.message}`);
if (h.loginHint) console.log(`Login hint: ${h.loginHint}`);
if (!h.authenticated) {
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

console.log("\n=== 2. Authority bulk ranks (sample domains) ===");
const domains = [
  "cinnamonsnail.com",
  "allrecipes.com",
  "nytimes.com",
  "wikipedia.org",
  "minimalistbaker.com",
  "example.com",
];
const { rows, cost: rankCost } = await backlinks.fetchBulkRanks(domains);
console.log(`Cost: ${String(rankCost)}`);
for (const row of [...rows].sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1))) {
  console.log(
    `  ${row.target.padEnd(28)} ${row.rank === null ? "n/a" : String(row.rank)}`,
  );
}

console.log(`\n=== 3. Live SERP: "${TEST_KEYWORD}" (${TEST_COUNTRY}) ===`);
let serpCallsToSerpApi = 0;
const originalFetch = globalThis.fetch;
// Detect accidental SerpApi traffic during this live DFS-only call.
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input?.url ?? "");
  if (url.includes("serpapi.com")) {
    serpCallsToSerpApi += 1;
    throw new Error("SerpApi must not be called during DataForSEO-only verify");
  }
  return originalFetch(input, init);
};

let live;
try {
  live = await serp.fetchDataForSeoOrganicSerp({
    keyword: TEST_KEYWORD,
    country: TEST_COUNTRY,
    language: "en",
    depth: 10,
  });
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`Provider path: dataforseo (direct adapter)`);
console.log(`SerpApi requests during call: ${String(serpCallsToSerpApi)}`);
console.log(`Estimated cost: ${String(live.cost)}`);
console.log(`Organic: ${String(live.organic.length)}`);
live.organic.slice(0, 10).forEach((r) => {
  console.log(
    `  ${String(r.position).padStart(2)}. ${r.domain} — ${r.title.slice(0, 70)}`,
  );
});
console.log(`PAA: ${String(live.paa.length)}`);
if (live.paa[0]) console.log(`  e.g. ${live.paa[0]}`);
console.log(`Related: ${String(live.relatedSearches.length)}`);
if (live.relatedSearches[0]) console.log(`  e.g. ${live.relatedSearches[0]}`);
console.log(`SERP features: ${live.serpFeatures.join(", ") || "(none)"}`);
console.log(`Total results: ${String(live.totalResults)}`);

console.log("\n=== 4. Compare to cached SerpApi (if present) ===");
try {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const cached = await prisma.serpCache.findUnique({
    where: {
      engine_query_country: {
        engine: "google",
        query: TEST_KEYWORD.toLowerCase(),
        country: TEST_COUNTRY,
      },
    },
  });
  if (!cached) {
    console.log("No cached SerpApi row for this keyword — skip comparison.");
  } else {
    const payload = cached.payload;
    const cachedOrganic = Array.isArray(payload?.organic_results)
      ? payload.organic_results
      : [];
    const liveUrls = new Set(
      live.organic.map((o) => o.url.replace(/\/$/, "").toLowerCase()),
    );
    const cachedUrls = cachedOrganic
      .map((r) => String(r.link ?? "").replace(/\/$/, "").toLowerCase())
      .filter(Boolean);
    const overlap = cachedUrls.filter((u) => liveUrls.has(u)).length;
    console.log(`Cached SerpApi fetchedAt: ${cached.fetchedAt.toISOString()}`);
    console.log(`Cached organic count: ${cachedOrganic.length}`);
    console.log(
      `URL overlap (top ${String(Math.min(10, cachedUrls.length))} vs live): ${String(overlap)}`,
    );
    console.log(
      "Note: SERP churn over days is expected; do not treat mismatch as a bug alone.",
    );
  }
  await prisma.$disconnect();
} catch (err) {
  console.log(`Cache compare skipped: ${err instanceof Error ? err.message : String(err)}`);
}

rmSync(out, { recursive: true, force: true });

const ok =
  live.organic.length > 0 &&
  serpCallsToSerpApi === 0 &&
  h.authenticated;

console.log("\n=== Summary ===");
console.log(`Authentication: ${h.status}`);
console.log(`Keyword: ${TEST_KEYWORD}`);
console.log(`Organic: ${live.organic.length > 0 ? "OK" : "EMPTY"}`);
console.log(`PAA: ${live.paa.length > 0 ? "OK" : "empty/unavailable"}`);
console.log(
  `Related: ${live.relatedSearches.length > 0 ? "OK" : "empty/unavailable"}`,
);
console.log(`SerpApi called first: NO (blocked; count=${String(serpCallsToSerpApi)})`);
console.log(
  ok
    ? "\nLIVE DataForSEO SERP verification PASSED."
    : "\nLIVE DataForSEO SERP verification FAILED.",
);
process.exit(ok ? 0 : 1);
