/**
 * Regression test: Markdown → anchor → HTML → WordPress output.
 *
 * Guards the bug the client reported, where an internal link written by the
 * Drafter reached the published article as visible Markdown:
 *   "[Vegan Ginger Cake](/vegan-ginger-cake/)"
 *
 * Runs the real modules rather than copies, compiled on the fly, so it fails if
 * the shipped implementation regresses. No test framework — this is one chain
 * with a handful of assertions, and a runner would be more setup than subject.
 *
 *   node scripts/test-links.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";


/*
 * These checks are pure functions, but a compiled module in the graph
 * imports the Prisma client, which validates its connection string at
 * import time. Nothing here opens a connection - the URL only has to
 * parse, so the suite stays runnable with no database and no .env.
 */
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";
const ROOT = process.cwd();
/*
 * Build inside the project, not the OS temp dir: link-index.ts imports the
 * Prisma client, and Node only resolves node_modules by walking up from the
 * importing file. A temp dir elsewhere on disk cannot see it.
 */
const out = mkdtempSync(join(ROOT, ".linktest-"));

const SOURCES = [
  "lib/markdown.ts",
  "lib/content/link-index.ts",
  "lib/wordpress/gutenberg.ts",
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
      // link-index.ts pulls in the Prisma client, which needs node globals.
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
  // Quoted: the project path contains a space, and shell:true would otherwise
  // split it and make tsc think it was given stray source files.
  execFileSync("npx", ["tsc", "-p", `"${tsconfig}"`], { stdio: "pipe", shell: true });
} catch (err) {
  console.error("tsc failed:\n" + String(err.stdout ?? err));
  process.exit(1);
}

/*
 * tsc keeps the `@/` specifiers, which Node cannot resolve. Rewriting them to
 * relative paths is cheaper than pulling in a loader hook for three files.
 */
const rewrite = (file) => {
  const p = join(out, file.replace(/\.ts$/, ".js"));
  const src = readFileSync(p, "utf8");
  const depth = file.split("/").length - 1;
  const prefix = "../".repeat(depth) || "./";
  writeFileSync(p, src.replace(/from "@\/(.*?)"/g, (_m, rest) => `from "${prefix}${rest}.js"`));
  return p;
};
SOURCES.forEach(rewrite);

const { markdownToHtml } = await import(
  pathToFileURL(join(out, "lib/markdown.js")).href
);
const { resolveLinks } = await import(
  pathToFileURL(join(out, "lib/content/link-index.js")).href
);
const { htmlToGutenberg } = await import(
  pathToFileURL(join(out, "lib/wordpress/gutenberg.js")).href
);

/* Stands in for a real synced site. Only these pages exist. */
const target = {
  title: "Vegan Ginger Cake",
  url: "https://cinnamonsnail.com/vegan-ginger-cake/",
  slug: "vegan-ginger-cake",
  wpId: 4211,
  type: "post",
  terms: ["vegan", "ginger", "cake"],
};
const index = {
  all: [target],
  bySlug: new Map([["vegan-ginger-cake", target]]),
  byTitle: new Map([["vegan ginger cake", target]]),
};

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

console.log("\nMarkdown → anchor → HTML → WordPress\n");

const md = "Serve it with my [Vegan Ginger Cake](/vegan-ginger-cake/) for dessert.";
const html = markdownToHtml(md);

check("markdown produces an anchor", html.includes("<a href="), html);
check("no raw markdown survives", !/\]\(/.test(html) && !html.includes("]("), html);

const { html: resolvedHtml, resolved, unresolved } = resolveLinks(html, index);

check(
  "relative href resolves to the real permalink",
  resolvedHtml.includes(`href="${target.url}"`),
  resolvedHtml,
);
check("anchor text is preserved", resolvedHtml.includes(">Vegan Ginger Cake<"), resolvedHtml);
check("resolution is reported", resolved.length === 1 && unresolved.length === 0);

const gutenberg = htmlToGutenberg(resolvedHtml);
check("WordPress output keeps the anchor", gutenberg.includes(`href="${target.url}"`), gutenberg);
check("WordPress output has no markdown", !gutenberg.includes("]("), gutenberg);

console.log("\nUnresolvable links are dropped, never invented\n");

const ghostMd = "Try my [Vegan Unicorn Pie](/vegan-unicorn-pie/) too.";
const ghostHtml = markdownToHtml(ghostMd);
const ghost = resolveLinks(ghostHtml, index);

check("unknown target produces no anchor", !ghost.html.includes("<a href="), ghost.html);
check("wording survives as plain text", ghost.html.includes("Vegan Unicorn Pie"), ghost.html);
check("no invented URL appears", !ghost.html.includes("vegan-unicorn-pie"), ghost.html);
check("flagged as an opportunity", ghost.unresolved.length === 1);

console.log("\nUnsafe schemes never become anchors\n");

for (const bad of [
  "[click](javascript:alert(1))",
  "[click](data:text/html;base64,PHN2Zz4=)",
  "[offsite](//evil.com/x)",
]) {
  const h = markdownToHtml(bad);
  check(`rejected: ${bad.slice(0, 34)}`, !h.includes("<a href="), h);
}

rmSync(out, { recursive: true, force: true });

console.log(
  failures === 0
    ? "\nAll link regression checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
