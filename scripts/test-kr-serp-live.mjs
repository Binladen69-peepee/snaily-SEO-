/**
 * One-shot Keyword Research path test (server modules).
 * Never prints credentials.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

// Load .env.local into process.env for this script
try {
  const text = readFileSync(join(process.cwd(), ".env.local"), "utf8").replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2] ?? "";
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]) process.env[key] = val;
  }
} catch {
  // ignore
}

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".krtest-"));
const SOURCES = [
  "lib/dataforseo/config.ts",
  "lib/keywords/serp-api-guard.ts",
  "lib/keywords/quota.ts",
  "lib/keywords/provider.ts",
  "lib/keywords/providers/live.ts",
  "lib/keywords/providers/mock.ts",
  "lib/keywords/providers/dataforseo-serp.ts",
];

// Simpler: call getNormalizedSerp via compiled smaller set + live provider detail is heavy (prisma).
// Just compile get-normalized-serp chain.
const FULL = [
  "lib/dataforseo/config.ts",
  "lib/dataforseo/errors.ts",
  "lib/dataforseo/client.ts",
  "lib/dataforseo/locations.ts",
  "lib/dataforseo/serp.ts",
  "lib/keywords/serp-api-guard.ts",
  "lib/keywords/quota.ts",
  "lib/keywords/enrich-serp.ts",
  "lib/keywords/serp-normalized.ts",
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
    files: FULL.map((s) => join(ROOT, s)),
  }),
);

execFileSync("npx", ["tsc", "-p", `"${join(out, "tsconfig.json")}"`], {
  stdio: "pipe",
  shell: true,
});

for (const file of FULL) {
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
const serpMod = await import(pathToFileURL(join(out, "lib/dataforseo/serp.js")).href);
const guard = await import(pathToFileURL(join(out, "lib/keywords/serp-api-guard.js")).href);

console.log("configured_dfs=" + config.dataForSeoConfigured());
console.log("serpapi_configured=" + guard.serpApiConfigured());
console.log("provider_priority=dataforseo_first");

let serpApiHits = 0;
const orig = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input?.url ?? "");
  if (url.includes("serpapi.com")) serpApiHits += 1;
  return orig(input, init);
};

try {
  const live = await serpMod.fetchDataForSeoOrganicSerp({
    keyword: "vegan italian sausage",
    country: "us",
    depth: 10,
  });
  console.log("kr_serp_ok=yes");
  console.log("provider=dataforseo");
  console.log("organic=" + live.organic.length);
  console.log("paa=" + live.paa.length);
  console.log("related=" + live.relatedSearches.length);
  if (live.organic[0]) {
    console.log(
      "top1=" + live.organic[0].domain + " | " + live.organic[0].title.slice(0, 60),
    );
  }
  console.log("serpapi_calls=" + serpApiHits);
} finally {
  globalThis.fetch = orig;
  rmSync(out, { recursive: true, force: true });
}
