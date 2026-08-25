/**
 * Unit tests for DrafterResearch (no live API required).
 *
 *   npm run test:drafter-research
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".drafter-research-"));

const SOURCES = ["lib/drafter/research.ts", "lib/text.ts"];

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

const mod = await import(
  pathToFileURL(join(out, "lib/drafter/research.js")).href
);

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("DrafterResearch unit tests\n");

const serp = {
  keyword: "vegan italian sausage",
  location: "us",
  language: "en",
  depth: 15,
  device: "desktop",
  organicResults: [
    {
      position: 1,
      title: "Easy Vegan Italian Sausage Recipe",
      url: "https://a.example/sausage",
      domain: "a.example",
      snippet: "",
      displayedLink: "",
      sourceName: "",
      favicon: "",
      publishedDate: null,
      sitelinks: 0,
      rating: null,
      reviews: null,
    },
    {
      position: 2,
      title: "Homemade Vegan Italian Sausage",
      url: "https://b.example/sausage",
      domain: "b.example",
      snippet: "",
      displayedLink: "",
      sourceName: "",
      favicon: "",
      publishedDate: null,
      sitelinks: 0,
      rating: null,
      reviews: null,
    },
    {
      position: 3,
      title: "Best Vegan Italian Sausage Crumbles",
      url: "https://c.example/sausage",
      domain: "c.example",
      snippet: "",
      displayedLink: "",
      sourceName: "",
      favicon: "",
      publishedDate: null,
      sitelinks: 0,
      rating: null,
      reviews: null,
    },
  ],
  paa: [
    "How do you cook vegan italian sausage?",
    "Can I freeze vegan italian sausage?",
    "Does this need coconut milk?",
    "Is plant-based sausage healthier than regular sausage?",
  ],
  relatedSearches: ["vegan sausage recipe", "italian seitan sausage"],
  serpFeatures: ["organic", "people_also_ask", "related_searches"],
  totalResults: 120000,
  provider: "dataforseo",
  retrievedAt: "2026-08-25T10:00:00.000Z",
  fromCache: false,
  estimatedCost: 0.002,
};

const research = mod.buildDrafterResearch({
  serp,
  difficultySignals: { difficulty: 42, volume: 2400, cpc: 0.4 },
  bodyTerms: ["fennel", "seitan"],
});

check("available", research.available === true);
check("provider dataforseo", research.provider === "dataforseo");
check("top results ≤ 15", research.topResults.length === 3);
check("intent informational", research.searchIntent === "informational");
check("title terms extracted", research.titleTerms.length > 0);
check("competitor domains", research.competitorDomains.includes("a.example"));

const recipe = "vegan italian sausage\nfennel seed\ngarlic\nseitan\nsoy sauce";
const filtered = mod.filterPaaForRecipe(research.paa, recipe, research.keyword);
check(
  "PAA keeps recipe-grounded questions",
  filtered.some((q) => /freeze/i.test(q)),
);
check(
  "PAA rejects coconut milk contamination",
  !filtered.some((q) => /coconut/i.test(q)),
);
check(
  "PAA rejects health-claim questions",
  !filtered.some((q) => /healthier/i.test(q)),
);

const stepsSlice = mod.researchSliceForSections(research, ["steps"], {
  recipeText: recipe,
});
check(
  "steps get no SERP dump",
  !stepsSlice.terms && !stepsSlice.questions && !stepsSlice.headings,
);

const faqSlice = mod.researchSliceForSections(research, ["faq"], {
  recipeText: recipe,
});
check("faq gets filtered PAA", (faqSlice.questions ?? []).length >= 1);
check(
  "faq PAA has no coconut",
  !(faqSlice.questions ?? []).some((q) => /coconut/i.test(q)),
);

const introSlice = mod.researchSliceForSections(research, ["intro"], {
  recipeText: recipe,
});
check("intro gets compact terms", (introSlice.terms ?? []).length > 0);
check("intro gets intent", introSlice.intent === "informational");

const seoSlice = mod.researchSliceForSections(research, ["seo"], {
  recipeText: recipe,
});
check("seo gets title terms", (seoSlice.titleTerms ?? []).length > 0);

const panel = mod.researchPanelSummary(research);
check("panel provider label", panel.providerLabel === "DataForSEO");
check("panel top results", panel.topResults === 3);

const empty = mod.emptyDrafterResearch("x");
check("empty unavailable", empty.available === false);
check(
  "empty panel",
  mod.researchPanelSummary(empty).available === false,
);

rmSync(out, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll DrafterResearch checks passed.");
