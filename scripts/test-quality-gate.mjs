/**
 * The draft quality gate, tested against the client's real articles.
 *
 * Two of these are the exact records behind the "Drafter writes placeholders"
 * report, and one is the draft that generated correctly before the regression.
 * A gate that cannot tell those apart is worthless, so the fixtures are the
 * real thing rather than invented strings.
 *
 *   node scripts/test-quality-gate.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";


const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".qgtest-"));
const SOURCES = [
  "lib/drafter/quality-gate.ts",
  "lib/drafter/readability.ts",
  "lib/drafter/post-template.ts",
];

writeFileSync(join(out, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    strict: false, skipLibCheck: true, types: [],
    baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: out, rootDir: ROOT,
  },
  files: SOURCES.map((s) => join(ROOT, s)),
}));

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

try {
  execFileSync("npx", ["tsc", "-p", `"${join(out, "tsconfig.json")}"`], { stdio: "pipe", shell: true });
} catch (err) {
  console.error("tsc failed:\n" + String(err.stdout ?? err));
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

for (const f of SOURCES) {
  const p = join(out, f.replace(/\.ts$/, ".js"));
  const depth = f.split("/").length - 1;
  const prefix = "../".repeat(depth) || "./";
  writeFileSync(p, readFileSync(p, "utf8").replace(/from "@\/(.*?)"/g, (_m, r) => `from "${prefix}${r}.js"`));
}

const { checkDraftQuality } = await import(
  pathToFileURL(join(out, "lib/drafter/quality-gate.js")).href
);

try {
  console.log("\nSynthetic cases");
  check(checkDraftQuality("").issues[0].code === "empty", "empty draft fails as empty");
  check(
    checkDraftQuality("<h2>A</h2><h2>B</h2><h2>C</h2>").ok === false,
    "headings with no prose fail",
  );
  check(
    checkDraftQuality("<p>[insert intro here]</p>".repeat(40)).issues.some(
      (i) => i.code === "placeholder-tokens",
    ),
    "square-bracket instructions are caught",
  );
  check(
    checkDraftQuality("<p>{{intro}}</p>".repeat(40)).issues.some((i) => i.code === "placeholder-tokens"),
    "handlebars tokens are caught",
  );
  check(
    checkDraftQuality("<p>TODO write this</p>".repeat(40)).issues.some((i) => i.code === "placeholder-tokens"),
    "TODO is caught",
  );
  check(
    checkDraftQuality("<p>Lorem ipsum dolor sit amet.</p>".repeat(40)).issues.some(
      (i) => i.code === "placeholder-tokens",
    ),
    "lorem ipsum is caught",
  );

  const shortReal = "<h2>Intro</h2><p>" + "This is genuine prose about soup. ".repeat(8) + "</p>";
  check(
    checkDraftQuality(shortReal).issues.some((i) => i.code === "too-short"),
    "real but far too short fails on length, not tokens",
  );

  console.log("\nThe section skeleton must always be rejected");
  const { buildPostTemplate } = await import(
    pathToFileURL(join(out, "lib/drafter/post-template.js")).href
  );
  const sk = checkDraftQuality(buildPostTemplate({ title: "Kabocha Squash Soup" }));
  check(sk.ok === false, "the built-in skeleton is rejected");
  check(
    sk.issues.some((i) => i.code === "skeleton-prompts"),
    "and the reason names the template prompts",
  );

  console.log("\nStructure and image placeholders");
  const noHeadings = "<p>" + "Real prose about soup that goes on a while. ".repeat(40) + "</p>";
  check(
    checkDraftQuality(noHeadings).issues.some((i) => i.code === "no-sections"),
    "prose with no headings is rejected - nothing to map into the template",
  );
  const withImage =
    "<h2>A</h2><h2>B</h2><h2>C</h2><h2>D</h2><p>" +
    "Real prose here for the section body. ".repeat(40) +
    "![Image of kabocha squash soup]</p>";
  check(
    checkDraftQuality(withImage).issues.some((i) => i.code === "placeholder-tokens"),
    "a leaked markdown image placeholder is caught",
  );
  check(
    checkDraftQuality(
      "<h2>A</h2><h2>B</h2><h2>C</h2><h2>D</h2><p>" +
        "Real prose here for the section body. ".repeat(40) +
        "<<<END>>></p>",
    ).issues.some((i) => i.code === "placeholder-tokens"),
    "a leaked pipeline delimiter is caught",
  );
  check(
    checkDraftQuality(
      "<h2>A</h2><h2>B</h2><h2>C</h2><h2>D</h2><p>" +
        "Real prose here for the section body. ".repeat(40) +
        "&lt;&lt;&lt;SECTION:intro&gt;&gt;&gt;</p>",
    ).issues.some((i) => i.code === "placeholder-tokens"),
    "an HTML-encoded pipeline delimiter is caught",
  );
  check(
    checkDraftQuality(
      "<h2>A</h2><h2>B</h2><h2>C</h2><h2>D</h2><p>" +
        "Real prose here for the section body. ".repeat(40) +
        "Try [vegan tamales](https://example.com/invented).</p>",
    ).issues.some((i) => i.code === "placeholder-tokens"),
    "a leftover markdown link is caught",
  );

  /*
   * The rest of this suite reads the client's real articles, so unlike the
   * others it genuinely needs a database. Run with `npm run test:quality`,
   * which supplies one; without a connection string the pure checks above
   * still run and the live pass is reported as skipped rather than crashing.
   */
  if ((process.env.DATABASE_URL ?? "") === "") {
    console.log("\nThe client's real articles: skipped, no DATABASE_URL set.");
    rmSync(out, { recursive: true, force: true });
    console.log(
      failures === 0
        ? "\nAll quality gate checks passed (live pass skipped).\n"
        : `\n${failures} FAILED\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  }

  console.log("\nThe client's real articles");
  const { PrismaClient } = await import(pathToFileURL(join(ROOT, "node_modules/@prisma/client/index.js")).href);
  const prisma = new PrismaClient();
  const rows = await prisma.article.findMany({
    where: { mode: "drafter" },
    select: { title: true, content: true, generated: true },
  });

  for (const a of rows) {
    const r = checkDraftQuality(a.content);
    const codes = r.issues.map((i) => i.code).join(",") || "none";
    console.log(
      `    ${(a.title || "(untitled)").slice(0, 28).padEnd(28)} ok=${String(r.ok).padEnd(5)} prose=${String(r.stats.proseWords).padStart(5)} skeleton=${String(r.stats.skeletonHits)} [${codes}]`,
    );
  }

  const ginger = rows.find((a) => /Gingerbread/i.test(a.title));
  check(
    ginger !== undefined && checkDraftQuality(ginger.content).ok === true,
    "the correctly generated Gingerbread article PASSES",
  );

  await prisma.$disconnect();
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll quality-gate checks passed.");
