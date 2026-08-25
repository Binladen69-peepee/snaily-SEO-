/**
 * Normalized SERP + DataForSEO organic mapping tests.
 *
 *   npm run test:serp-normalized
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".serpnorm-"));

const SOURCES = [
  "lib/dataforseo/config.ts",
  "lib/dataforseo/errors.ts",
  "lib/dataforseo/client.ts",
  "lib/dataforseo/locations.ts",
  "lib/dataforseo/serp.ts",
  "lib/keywords/serp-api-guard.ts",
  "lib/keywords/quota.ts",
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

const serp = await import(pathToFileURL(join(out, "lib/dataforseo/serp.js")).href);
const locations = await import(
  pathToFileURL(join(out, "lib/dataforseo/locations.js")).href
);
const guard = await import(
  pathToFileURL(join(out, "lib/keywords/serp-api-guard.js")).href
);

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

console.log("Normalized SERP / DataForSEO organic");

check("US location code", locations.dataForSeoLocationCode("us") === 2840);
check("UK location code", locations.dataForSeoLocationCode("uk") === 2826);
check("any → US", locations.dataForSeoLocationCode("any") === 2840);
check("language en-US → en", locations.dataForSeoLanguageCode("en-US") === "en");

const parsed = serp.parseDfsSerpBlock({
  se_results_count: 1_200_000,
  item_types: ["organic", "people_also_ask", "related_searches", "ai_overview"],
  items: [
    {
      type: "organic",
      rank_group: 1,
      title: "Vegan Tamale Pie",
      url: "https://cinnamonsnail.com/vegan-tamale-pie/",
      domain: "cinnamonsnail.com",
      description: "A cozy casserole…",
      breadcrumb: "cinnamonsnail.com › recipes",
      website_name: "Cinnamon Snail",
      links: [{}, {}],
      rating: { value: 4.8, votes_count: 120 },
      date: "2 days ago",
    },
    {
      type: "people_also_ask",
      items: [{ title: "What is vegan tamale pie?" }, { question: "How long to bake?" }],
    },
    {
      type: "related_searches",
      items: ["vegan tamale casserole", { title: "tamale pie recipe" }],
    },
  ],
});

check("organic count", parsed.organic.length === 1);
check("organic position", parsed.organic[0].position === 1);
check("organic title", parsed.organic[0].title.includes("Tamale"));
check("organic domain", parsed.organic[0].domain === "cinnamonsnail.com");
check("sitelinks", parsed.organic[0].sitelinks === 2);
check("paa", parsed.paa.length === 2 && parsed.paa[0].includes("tamale"));
check("related", parsed.relatedSearches.length === 2);
check("features include organic", parsed.serpFeatures.includes("organic"));
check("features include paa", parsed.serpFeatures.includes("people_also_ask"));
check("total results", parsed.totalResults === 1_200_000);

guard.clearSerpApiQuotaExhaustion();
check("quota not blocked initially", guard.serpApiQuotaBlocked() === false);
guard.markSerpApiQuotaExhausted(60_000);
check("quota blocked after mark", guard.serpApiQuotaBlocked() === true);
guard.clearSerpApiQuotaExhaustion();
check("quota cleared", guard.serpApiQuotaBlocked() === false);

rmSync(out, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${String(failures)} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll normalized SERP tests passed.");
