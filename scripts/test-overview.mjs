/**
 * Regression test: the domain overview never shows one site's data under
 * another site's name.
 *
 * The overview is asked for whatever domain is in the search box, which is
 * usually *not* the active project. If the ownership check were dropped or
 * loosened, searching a competitor would quietly render your own Search
 * Console traffic labelled as theirs — a wrong answer that looks completely
 * plausible. These checks run the real module against the real database.
 *
 *   node scripts/test-overview.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
// Built inside the project: domain-overview.ts imports the Prisma client, and
// Node only finds node_modules by walking up from the importing file.
const out = mkdtempSync(join(ROOT, ".overviewtest-"));

const SOURCES = [
  "lib/domain-overview.ts",
  "lib/countries.ts",
  "lib/db.ts",
  "lib/google/types.ts",
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

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

try {
  // Quoted: the project path contains a space, which shell:true would split.
  execFileSync("npx", ["tsc", "-p", `"${tsconfig}"`], { stdio: "pipe", shell: true });
} catch (err) {
  console.error("tsc failed:\n" + String(err.stdout ?? err));
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
};
SOURCES.forEach(rewrite);

const { getDomainOverview, parseRange, OVERVIEW_RANGES } = await import(
  pathToFileURL(join(out, "lib/domain-overview.js")).href
);
const { countryName } = await import(
  pathToFileURL(join(out, "lib/countries.js")).href
);
const { prisma } = await import(pathToFileURL(join(out, "lib/db.js")).href);

try {
  /* ---------- Range parsing ---------- */
  console.log("\nRange parsing");
  check(parseRange(undefined) === "30d", "missing range falls back to 30d");
  check(parseRange("bogus") === "30d", "unknown range falls back to 30d");
  check(parseRange("1y") === "1y", "1y is accepted");
  check(OVERVIEW_RANGES.length === 4, "four ranges offered");

  /* ---------- Ownership ---------- */
  const user = await prisma.user.findFirst({ select: { id: true } });
  const project = await prisma.project.findFirst({
    where: { userId: user?.id },
    select: { url: true, gscSiteUrl: true },
  });

  if (!user || !project) {
    console.error("\nNo user/project in the database to test against.");
    process.exit(1);
  }

  const own = project.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  console.log("\nOwnership gating");

  const anonymous = await getDomainOverview(own, null, "30d");
  check(
    anonymous.gap === "NOT_YOUR_SITE",
    "signed-out request gets no measured data even for a known domain",
  );

  const stranger = await getDomainOverview("nytimes.com", user.id, "30d");
  check(
    stranger.gap === "NOT_YOUR_SITE",
    "a domain the user owns no project for is NOT_YOUR_SITE",
  );
  check(
    stranger.traffic.length === 0 &&
      stranger.countries.length === 0 &&
      stranger.topPages.length === 0 &&
      stranger.positions.length === 0,
    "an unowned domain returns no rows in any panel",
  );
  check(
    stranger.totalClicks === 0 && stranger.totalImpressions === 0,
    "an unowned domain reports zero traffic rather than a number",
  );

  const mine = await getDomainOverview(own, user.id, "30d");
  const expected = project.gscSiteUrl === null ? "NOT_CONNECTED" : null;
  check(
    project.gscSiteUrl === null
      ? mine.gap === "NOT_CONNECTED"
      : mine.gap === null || mine.gap === "NOT_SYNCED",
    `own domain (${own}) reports ${String(mine.gap)}, expected ${String(expected ?? "data or NOT_SYNCED")}`,
  );

  // www. and scheme prefixes must not defeat the match, or a user's own site
  // would look like a stranger's the moment it was typed with a prefix.
  const withWww = await getDomainOverview(`www.${own}`, user.id, "30d");
  check(
    withWww.gap === mine.gap,
    "www. prefix resolves to the same project as the bare domain",
  );

  /* ---------- New tables are live ---------- */
  console.log("\nSchema");
  const countryRows = await prisma.gscCountryMetric.count();
  const countryKeywords = await prisma.gscCountryKeyword.count();
  check(
    Number.isInteger(countryRows),
    `GscCountryMetric is queryable (${String(countryRows)} rows)`,
  );
  check(
    Number.isInteger(countryKeywords),
    `GscCountryKeyword is queryable (${String(countryKeywords)} rows)`,
  );

  /* ---------- Country naming ---------- */
  console.log("\nCountry names");
  check(countryName("usa") === "United States", "usa → United States");
  check(countryName("gbr") === "United Kingdom", "gbr → United Kingdom");
  check(countryName("xyz") === "XYZ", "unknown code falls back to caps, not blank");
  check(countryName("") === "Unknown", "empty code is labelled, not dropped");

  await prisma.$disconnect();
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll domain-overview checks passed.");
