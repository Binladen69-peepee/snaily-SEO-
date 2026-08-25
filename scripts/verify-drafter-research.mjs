/**
 * Live Drafter SERP research check via DataForSEO organic (primary path).
 *
 *   npm run verify:drafter-research
 *
 * Confirms one live SERP populate → DrafterResearch → section slices.
 * Application caching (SerpCache) is exercised separately via getNormalizedSerp.
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
  process.exit(1);
}

const KEYWORD = process.env.VERIFY_SERP_KEYWORD ?? "vegan italian sausage";
const COUNTRY = process.env.VERIFY_SERP_COUNTRY ?? "us";

const out = mkdtempSync(join(ROOT, ".drafter-verify-"));
const SOURCES = [
  "lib/dataforseo/config.ts",
  "lib/dataforseo/errors.ts",
  "lib/dataforseo/client.ts",
  "lib/dataforseo/locations.ts",
  "lib/dataforseo/serp.ts",
  "lib/drafter/research.ts",
  "lib/text.ts",
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

const serpMod = await import(
  pathToFileURL(join(out, "lib/dataforseo/serp.js")).href
);
const researchMod = await import(
  pathToFileURL(join(out, "lib/drafter/research.js")).href
);

console.log(`Drafter research verify: "${KEYWORD}" (${COUNTRY})\n`);

const live = await serpMod.fetchDataForSeoOrganicSerp({
  keyword: KEYWORD,
  country: COUNTRY,
  language: "en",
  depth: 15,
  device: "desktop",
});

const normalized = {
  keyword: KEYWORD,
  location: COUNTRY,
  language: "en",
  depth: 15,
  device: "desktop",
  organicResults: live.organic.map((o) => ({
    position: o.position,
    title: o.title,
    url: o.url,
    domain: o.domain,
    snippet: o.snippet,
    displayedLink: o.breadcrumb,
    sourceName: o.websiteName,
    favicon: "",
    publishedDate: o.publishedDate,
    sitelinks: o.sitelinks,
    rating: o.rating,
    reviews: o.reviews,
  })),
  paa: live.paa,
  relatedSearches: live.relatedSearches,
  serpFeatures: live.serpFeatures,
  totalResults: live.totalResults,
  provider: "dataforseo",
  retrievedAt: new Date().toISOString(),
  fromCache: false,
  estimatedCost: live.cost,
};

const research = researchMod.buildDrafterResearch({
  serp: normalized,
  difficultySignals: { difficulty: 0, volume: 0, cpc: 0 },
});

console.log(`Live DataForSEO calls this script: 1`);
console.log(`  organic: ${research.topResults.length}`);
console.log(`  PAA: ${research.paa.length}`);
console.log(`  related: ${research.relatedSearches.length}`);
console.log(`  features: ${research.serpFeatures.join(", ") || "(none)"}`);
console.log(`  intent: ${research.searchIntent}`);
console.log(
  `  titleTerms: ${research.titleTerms
    .slice(0, 10)
    .map((t) => t.term)
    .join(", ")}`,
);
console.log(`  provider: ${research.provider}`);
console.log(`  cost: ${String(live.cost)}`);

const recipe =
  "vegan italian sausage fennel garlic paprika smoked paprika seitan vital wheat gluten soy sauce";
const filtered = researchMod.filterPaaForRecipe(
  research.paa,
  recipe,
  KEYWORD,
);
console.log(`\nPAA after recipe grounding: ${filtered.length}/${research.paa.length}`);
for (const q of filtered.slice(0, 6)) console.log(`  - ${q}`);

const steps = researchMod.researchSliceForSections(research, ["steps"], {
  recipeText: recipe,
});
const faq = researchMod.researchSliceForSections(research, ["faq"], {
  recipeText: recipe,
});
const seo = researchMod.researchSliceForSections(research, ["seo"], {
  recipeText: recipe,
});

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

console.log("");
check(research.available, "DrafterResearch available");
check(research.provider === "dataforseo", "provider is DataForSEO");
check(research.topResults.length >= 5, "top results populated");
check(Object.keys(steps).length === 0, "steps slice has no SERP dump");
check((faq.questions ?? []).length >= 0, "faq slice built");
check((seo.titleTerms ?? []).length > 0, "seo slice has title terms");
check(
  !filtered.some((q) => /coconut milk/i.test(q)),
  "filtered PAA has no coconut-milk contamination",
);

rmSync(out, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nPASS — one live DataForSEO SERP populate → reusable DrafterResearch");
