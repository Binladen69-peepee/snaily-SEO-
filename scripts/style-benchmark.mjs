/**
 * Scores a draft against the client's published posts and prints why.
 *
 * The same computation the pipeline runs at stage 11, available by hand so a
 * prompt change can be judged on a draft that already exists rather than on a
 * fresh nine-minute generation.
 *
 *   npm run style:benchmark
 *   npm run style:benchmark -- <articleId>
 */
import { PrismaClient } from "@prisma/client";

import { compile } from "./compile.mjs";

const prisma = new PrismaClient();
const CORPUS_SIZE = 6;

async function main() {
  const built = compile(
    [
      "lib/drafter/style-benchmark.ts",
      "lib/drafter/style-check.ts",
      "lib/drafter/style-metrics.ts",
      "lib/drafter/recipe.ts",
      "lib/db.ts",
    ],
    { prefix: ".benchmark-" },
  );
  const { benchmark } = await built.load("lib/drafter/style-benchmark.ts");
  const { parseRecipe } = await built.load("lib/drafter/recipe.ts");

  const id = process.argv[2];
  const article =
    id !== undefined
      ? await prisma.article.findUnique({ where: { id } })
      : await prisma.article.findFirst({
          where: { mode: "drafter", content: { not: "" } },
          orderBy: { updatedAt: "desc" },
        });
  if (article === null) throw new Error("No drafted article to score.");

  const corpus = (
    await prisma.wpPost.findMany({
      where: { projectId: article.projectId, status: "publish", type: "post" },
      orderBy: { publishedAt: "desc" },
      take: CORPUS_SIZE,
      select: { content: true },
    })
  ).map((r) => r.content);

  const result = benchmark({
    html: article.content,
    recipeIngredients: parseRecipe(article.recipeCard).ingredients,
    corpus,
  });

  console.log(`\n${article.title}`);
  console.log(`${result.metrics.words} words, measured against ${corpus.length} published posts\n`);

  const line = (label, value, note = "") =>
    console.log(`  ${label.padEnd(20)}${String(value).padStart(6)}   ${note}`);

  line("style match", `${result.styleMatch}%`, result.styleMatch >= 65 ? "" : "below 65");
  line("generic AI", result.genericAi, "hits per 1,000 words");
  line("grounding", `${result.grounding}%`, result.grounding === 100 ? "" : "ungrounded content");
  line("section compliance", `${result.sectionCompliance}%`);
  line("invented claims", result.inventedClaims, result.inventedClaims === 0 ? "" : "HARD FAIL");
  console.log(`\n  ${result.passed ? "PASS" : "FAIL"}`);

  if (result.issues.length > 0) {
    console.log(`\nIssues (${result.issues.length})`);
    const bySection = new Map();
    for (const issue of result.issues) {
      const key = issue.section ?? "intro";
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key).push(issue);
    }
    for (const [section, list] of bySection) {
      console.log(`\n  ${section}`);
      for (const issue of list) {
        console.log(`    ${issue.severity === "fail" ? "!" : "·"} ${issue.rule}: ${issue.detail}`);
        if (issue.evidence) console.log(`        "${issue.evidence}"`);
      }
    }
  }

  built.cleanup();
}

await main()
  .catch((err) => {
    console.error("\n", err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
