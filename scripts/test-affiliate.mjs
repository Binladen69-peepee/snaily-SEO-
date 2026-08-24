/**
 * Regression tests for automatic ingredient linking.
 *
 * This code rewrites the author's draft, so the failure modes are expensive:
 * a nested anchor is invalid HTML, a link on every "salt" reads as thin
 * affiliate content, and an affiliate link without rel="sponsored" is a manual
 * action waiting to happen. Each of those is pinned below.
 *
 *   node scripts/test-affiliate.mjs
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
const out = mkdtempSync(join(ROOT, ".afftest-"));

const SOURCES = ["lib/content/affiliate.ts", "lib/db.ts", "lib/drafter/post-template.ts"];

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

for (const file of SOURCES) {
  const p = join(out, file.replace(/\.ts$/, ".js"));
  const src = readFileSync(p, "utf8");
  const prefix = "../".repeat(file.split("/").length - 1) || "./";
  writeFileSync(
    p,
    src.replace(/from "@\/(.*?)"/g, (_m, rest) => `from "${prefix}${rest}.js"`),
  );
}

const A = await import(pathToFileURL(join(out, "lib/content/affiliate.js")).href);

const index = (rows) => ({
  terms: rows
    .map((r) => ({ ...r, words: r.term.split(" ").length }))
    .sort((a, b) => b.words - a.words || b.term.length - a.term.length),
});

const IDX = index([
  { term: "mexican chili powder", url: "https://amzn.to/45D5yqL", kind: "affiliate" },
  { term: "ancho chili powder", url: "https://amzn.to/3RZGsfQ", kind: "affiliate" },
  { term: "chili powder", url: "https://amzn.to/chili", kind: "affiliate" },
  { term: "smoked paprika", url: "https://shareasale.com/smoked", kind: "affiliate" },
  { term: "paprika", url: "https://shareasale.com/paprika", kind: "affiliate" },
  { term: "tamari", url: "https://amzn.to/46gTKcP", kind: "affiliate" },
  { term: "oregano", url: "https://amzn.to/3Vx79tu", kind: "affiliate" },
  {
    term: "madras curry powder",
    url: "https://cinnamonsnail.com/madras-curry-powder/",
    kind: "internal",
  },
]);

try {
  /* ------------------------------------------------------------------ */
  console.log("\nSection scoping");

  const doc =
    "<p>This intro mentions tamari and paprika before any heading.</p>" +
    "<h2>🌶 Ingredients for beet hummus</h2>" +
    "<p>You need smoked paprika and tamari for this.</p>" +
    "<h2>🤯 Variations</h2>" +
    "<p>Swap in more paprika or extra tamari if you like.</p>";

  const r1 = A.applyAffiliateLinks(doc, IDX);
  const intro = r1.html.slice(0, r1.html.indexOf("<h2"));
  check(!intro.includes("<a "), "nothing before the first heading is linked");
  check(
    r1.html.includes('<h2>🌶 Ingredients for beet hummus</h2><p>You need <a href="https://shareasale.com/smoked"'),
    "the ingredients section is linked",
  );
  const variations = r1.html.slice(r1.html.lastIndexOf("Variations"));
  check(!variations.includes("<a "), "the Variations section is left alone");

  /* ------------------------------------------------------------------ */
  console.log("\nLongest match wins");

  // Asserted as href + anchor text separately: an affiliate link carries rel
  // and target between the two, so they are never adjacent in the output.
  const r2 = A.applyAffiliateLinks(
    "<h2>Ingredients</h2><p>Use mexican chili powder here.</p>",
    IDX,
  );
  check(
    r2.html.includes('href="https://amzn.to/45D5yqL"') &&
      r2.html.includes(">mexican chili powder</a>"),
    "'mexican chili powder' beats 'chili powder' and 'chili'",
  );
  check(
    !r2.html.includes("mexican <a") && !r2.html.includes("</a> powder"),
    "the longer term is not chopped in half by a shorter one",
  );
  check(
    (r2.html.match(/<a /g) ?? []).length === 1,
    "the shorter term does not nest a second anchor inside the first",
  );

  const r3 = A.applyAffiliateLinks(
    "<h2>Ingredients</h2><p>Add smoked paprika to taste.</p>",
    IDX,
  );
  check(
    r3.html.includes('href="https://shareasale.com/smoked"') &&
      r3.html.includes(">smoked paprika</a>"),
    "'smoked paprika' beats 'paprika'",
  );
  check(
    !r3.html.includes('href="https://shareasale.com/paprika"'),
    "the bare 'paprika' link is not also applied to the same words",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nFirst mention only");

  const r4 = A.applyAffiliateLinks(
    "<h2>Ingredients</h2><p>Tamari here. And tamari again. Plus tamari once more.</p>",
    IDX,
  );
  check(
    (r4.html.match(/<a /g) ?? []).length === 1,
    `only one link for three mentions (got ${String((r4.html.match(/<a /g) ?? []).length)})`,
  );
  check(r4.html.includes(">Tamari</a>"), "the original capitalisation is kept");

  /* ------------------------------------------------------------------ */
  console.log("\nrel attributes");

  check(
    r4.html.includes('rel="sponsored nofollow"'),
    "affiliate links carry rel=\"sponsored nofollow\"",
  );

  const r5 = A.applyAffiliateLinks(
    "<h2>Ingredients</h2><p>Use madras curry powder.</p>",
    IDX,
  );
  check(
    r5.html.includes('href="https://cinnamonsnail.com/madras-curry-powder/">'),
    "an own-site link is applied",
  );
  check(
    !r5.html.includes("rel="),
    "an own-site link does NOT get nofollow, which would waste its link equity",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nProtected spans");

  const r6 = A.applyAffiliateLinks(
    '<h2>Ingredients</h2><p>Already linked <a href="https://example.com/x">tamari</a> here.</p>',
    IDX,
  );
  check(
    (r6.html.match(/<a /g) ?? []).length === 1,
    "an existing anchor is not wrapped in a second one",
  );
  check(
    r6.html.includes('href="https://example.com/x"'),
    "the author's own link is preserved",
  );

  const r7 = A.applyAffiliateLinks(
    "<h2>Ingredients</h2><h3>Tamari</h3><p>Notes about it.</p>",
    IDX,
  );
  check(!r7.html.includes("<h3><a"), "headings are never linked");

  const r8 = A.applyAffiliateLinks(
    '<h2>Ingredients</h2><p><img src="https://x.com/paprika.jpg" alt="paprika in a bowl"/></p>',
    IDX,
  );
  check(
    !r8.html.includes("<a "),
    "text inside attributes (src, alt) is never turned into a link",
  );
  check(
    r8.html.includes('alt="paprika in a bowl"'),
    "the alt attribute survives untouched",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nWord boundaries");

  const r9 = A.applyAffiliateLinks(
    "<h2>Ingredients</h2><p>Tamarind is not tamari.</p>",
    IDX,
  );
  check(
    !r9.html.includes(">Tamari</a>rind") && !r9.html.includes("Tamari</a>nd"),
    "'tamari' does not match inside 'tamarind'",
  );

  const r10 = A.applyAffiliateLinks(
    "<h2>Ingredients</h2><p>Add oregano, then salt.</p>",
    IDX,
  );
  check(
    r10.html.includes(">oregano</a>,"),
    "a term followed by a comma still matches",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nNo linkable section");

  const r11 = A.applyAffiliateLinks("<p>Just prose with tamari, no headings.</p>", IDX);
  check(r11.html.includes("<p>Just prose with tamari"), "a doc with no H2 is returned unchanged");
  check(r11.linked.length === 0, "and reports nothing linked");

  /* ------------------------------------------------------------------ */
  console.log("\nReporting");
  check(
    r1.linked.some((l) => l.term === "smoked paprika" && l.kind === "affiliate"),
    "linked terms are reported back with their kind",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nCSV import against the real file");

  let csv = null;
  for (const p of [
    "C:/Users/pc/Downloads/ingredients (1).csv",
    join(ROOT, "ingredients.csv"),
  ]) {
    try {
      csv = readFileSync(p, "utf8");
      break;
    } catch {
      /* try the next path */
    }
  }

  if (csv === null) {
    console.log("  SKIP  the source spreadsheet is not on this machine");
  } else {
    const parsed = A.parseAffiliateCsv(csv, "cinnamonsnail.com");
    check(
      parsed.terms.length === 534,
      `534 linkable terms parsed (got ${String(parsed.terms.length)})`,
    );
    check(
      parsed.skippedBadUrl === 36,
      `36 rows with a non-URL in the url column are skipped (got ${String(parsed.skippedBadUrl)})`,
    );
    check(parsed.skippedNoUrl > 1000, "rows with no URL are counted, not silently dropped");

    const internal = parsed.terms.filter((t) => t.kind === "internal");
    check(
      internal.length === 75,
      `75 own-site links classified as internal (got ${String(internal.length)})`,
    );
    check(
      parsed.terms.every((t) => /^https?:\/\//i.test(t.url)),
      "every imported row has a real URL",
    );
    check(
      new Set(parsed.terms.map((t) => t.term)).size === parsed.terms.length,
      "no duplicate terms survive the import",
    );
    check(
      parsed.terms.every((t) => t.words === t.term.split(" ").length),
      "word counts are computed for longest-first sorting",
    );

    const generics = parsed.terms.filter((t) => A.GENERIC_TERMS.has(t.term));
    check(
      generics.length > 0,
      `${String(generics.length)} bare generics found, to be imported disabled`,
    );
  }

  /* ------------------------------------------------------------------ */
  console.log("\nPost template");
  const T = await import(
    pathToFileURL(join(out, "lib/drafter/post-template.js")).href
  );
  const tpl = T.buildPostTemplate({ title: "Vegan Beet Hummus" });

  const HEADINGS = [
    "🥰 Why you'll adore",
    "Ingredients for",
    "🤯 Variations",
    "📖 How to make",
    "💡 Serving ideas",
    "👉 Top tips",
    "🤷‍♀️ Recipe FAQs",
    "✌️ You'll love these too",
  ];
  for (const h of HEADINGS) {
    check(tpl.includes(h), `template has the "${h}" heading`);
  }

  // The recipe-card H2 is the one heading the published posts leave bare.
  const recipeHeading = /<h2>([^<]*Recipe[^<]*)<\/h2>/.exec(
    tpl.slice(tpl.lastIndexOf("<h2>Recipe</h2>")),
  );
  check(
    recipeHeading !== null && !/[\u{1F300}-\u{1FAFF}]/u.test(recipeHeading[1]),
    "the recipe-card H2 carries no emoji",
  );

  check((tpl.match(/<h3>Step /g) ?? []).length === 8, "eight method steps are stubbed");
  check(tpl.includes("wp:wp-recipe-maker/recipe"), "the WPRM recipe block is present");
  check(tpl.includes("wp:feast/jump-to"), "the Feast jump-to block is present");
  check(
    tpl.includes("See the recipe card at the bottom"),
    "the recipe-card note is reproduced",
  );
  check(T.countPlaceholders(tpl) > 10, "placeholders are marked for the author to fill");

  const stripped = T.stripPlaceholders(tpl);
  check(!stripped.includes(T.PLACEHOLDER), "stripping removes every marker");
  check(
    !stripped.includes("Hook — three or four sentences"),
    "unfilled prompt text never ships to WordPress",
  );
  check(
    stripped.includes("<h2>🥰 Why you'll adore Vegan Beet Hummus</h2>"),
    "headings survive stripping",
  );
  check(!/<ul>\s*<\/ul>/.test(stripped), "lists emptied by stripping are removed");

  // The template must be linkable: the matcher needs to find its ingredients H2.
  const regions = A.linkableRegions(tpl);
  check(
    regions.length >= 2,
    `the matcher finds the ingredients and recipe sections (got ${String(regions.length)})`,
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll affiliate-link checks passed.");
