/**
 * SAFE DataForSEO / SERP provider diagnostic.
 * Never prints credential values — only exists/length/status.
 *
 *   npm run diagnose:dataforseo
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const envPath = join(ROOT, ".env.local");

console.log("=== File ===");
console.log(`.env.local exists: ${existsSync(envPath) ? "yes" : "no"}`);

const NAMES = [
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "DATAFORSEO_API_LOGIN",
  "DATAFORSEO_API_PASSWORD",
  "DFS_LOGIN",
  "DFS_PASSWORD",
  "SERPAPI_KEY",
  "KEYWORD_PROVIDER",
];

if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  const hasBom = text.charCodeAt(0) === 0xfeff;
  console.log(`UTF-8 BOM: ${hasBom ? "yes (usually OK for later keys)" : "no"}`);
  console.log("\n=== Keys in .env.local (names only) ===");
  for (const name of NAMES) {
    // Match start-of-line key=… (not comments)
    const re = new RegExp(`^\\s*${name}\\s*=(.*)$`, "m");
    const m = text.replace(/^\uFEFF/, "").match(re);
    if (!m) {
      console.log(`${name}: present_in_file=no`);
      continue;
    }
    const raw = m[1] ?? "";
    const trimmed = raw.trim().replace(/^["']|["']$/g, "");
    console.log(
      `${name}: present_in_file=yes value_empty=${trimmed === "" ? "yes" : "no"} trim_len=${trimmed.length}`,
    );
  }
}

console.log("\n=== process.env after --env-file=.env.local ===");
for (const name of NAMES) {
  const v = (process.env[name] ?? "").trim();
  console.log(
    `${name}: exists=${v !== "" ? "yes" : "no"} len=${v.length}`,
  );
}

const login = (process.env.DATAFORSEO_LOGIN ?? process.env.DATAFORSEO_API_LOGIN ?? process.env.DFS_LOGIN ?? "").trim();
const password = (process.env.DATAFORSEO_PASSWORD ?? process.env.DATAFORSEO_API_PASSWORD ?? process.env.DFS_PASSWORD ?? "").trim();
const configured = login !== "" && password !== "";

console.log("\n=== Config loader expectation ===");
console.log("Canonical names: DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD");
console.log(`provider_configured: ${configured ? "yes" : "no"}`);
console.log(`login_len: ${login.length}`);
console.log(`password_len: ${password.length}`);

if (!configured) {
  console.log("\nROOT CAUSE: DataForSEO credentials are not loaded into process.env.");
  console.log("Add these lines to .env.local (no quotes needed), SAVE the file, then restart npm run dev:");
  console.log("  DATAFORSEO_LOGIN=your_api_login_email");
  console.log("  DATAFORSEO_PASSWORD=your_api_password");
  process.exit(1);
}

// Live auth + SERP when configured
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";
const out = mkdtempSync(join(ROOT, ".dfsdiag-"));
const SOURCES = [
  "lib/dataforseo/config.ts",
  "lib/dataforseo/errors.ts",
  "lib/dataforseo/client.ts",
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

const config = await import(pathToFileURL(join(out, "lib/dataforseo/config.js")).href);
const health = await import(pathToFileURL(join(out, "lib/dataforseo/health.js")).href);
const serp = await import(pathToFileURL(join(out, "lib/dataforseo/serp.js")).href);

console.log("\n=== dataForSeoConfigured() ===");
console.log(`configured: ${config.dataForSeoConfigured() ? "yes" : "no"}`);

console.log("\n=== Authentication ===");
const h = await health.checkDataForSeoHealth();
console.log(`status: ${h.status}`);
console.log(`authenticated: ${h.authenticated ? "yes" : "no"}`);
console.log(`message: ${h.message}`);
if (h.loginHint) console.log(`login_hint: ${h.loginHint}`);

if (!h.authenticated) {
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

console.log("\n=== Live SERP (vegan italian sausage) ===");
let serpApiHits = 0;
const orig = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input?.url ?? "");
  if (url.includes("serpapi.com")) serpApiHits += 1;
  return orig(input, init);
};
try {
  const live = await serp.fetchDataForSeoOrganicSerp({
    keyword: "vegan italian sausage",
    country: "us",
    depth: 10,
  });
  console.log(`serp_success: yes`);
  console.log(`organic_count: ${live.organic.length}`);
  console.log(`paa_count: ${live.paa.length}`);
  console.log(`related_count: ${live.relatedSearches.length}`);
  console.log(`features: ${live.serpFeatures.join(", ") || "(none)"}`);
  console.log(`estimated_cost: ${live.cost}`);
  console.log(`serpapi_requests_during_dfs_call: ${serpApiHits}`);
  console.log(`provider_selected: dataforseo (primary)`);
} catch (err) {
  console.log(`serp_success: no`);
  console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
} finally {
  globalThis.fetch = orig;
}

rmSync(out, { recursive: true, force: true });
console.log("\nDiagnostic PASSED — DataForSEO is ready for Keyword Research.");
console.log("Restart `npm run dev` if it was already running before you saved .env.local.");
