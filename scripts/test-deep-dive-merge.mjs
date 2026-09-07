/**
 * Merge Deep Dive phrases in-process (no Prisma).
 *   node scripts/test-deep-dive-merge.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".ddmerge-"));
const SOURCES = [
  "lib/keywords/types.ts",
  "lib/keywords/estimate.ts",
  "lib/keywords/intent-tabs.ts",
  "lib/keywords/deep-dive-sources.ts",
  "lib/keywords/deep-dive-merge.ts",
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
      types: [],
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
  console.error("tsc failed:\n" + String(err.stdout ?? err));
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

const { mergeDeepDive, isUsable } = await import(
  pathToFileURL(join(out, "lib/keywords/deep-dive-merge.js")).href
);

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

try {
  check(isUsable("how to become a pharmacist", "how"), "usable phrase kept");
  check(!isUsable("how a", "how"), "alphabet pad dropped");

  const result = mergeDeepDive({
    keyword: "vegan sausage",
    country: "us",
    filters: {},
    sourcePhrases: [
      { source: "google", phrases: ["vegan sausage", "vegan sausage recipe"], isMock: false },
      { source: "bing", phrases: ["vegan sausage recipe", "best vegan sausage"], isMock: false },
      { source: "amazon", phrases: [], isMock: false },
    ],
  });

  check(result.rows.length >= 3, `merged ${String(result.rows.length)} rows`);
  check(
    result.emptySources.includes("Amazon Suggest"),
    "empty source is named in the notice list",
  );
  const recipe = result.rows.find((r) => r.keyword === "vegan sausage recipe");
  check(recipe?.sources.length === 2, "overlapping phrase keeps both sources");
  check(result.rows.every((r) => r.serp === null), "merge never fabricates SERP snapshots");
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log("\nAll merge checks passed.");
