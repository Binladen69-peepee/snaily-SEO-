/**
 * How far the Drafter's prose is from the client's, in numbers.
 *
 * Prints the reference profile (the client's own published posts), the profile
 * of a generated draft, and the gap between them. Run it before and after a
 * prompt change to find out whether the change did anything, rather than
 * reading two drafts and forming an impression.
 *
 *   npm run style:gap                 # newest drafter article vs the corpus
 *   npm run style:gap -- <articleId>
 */
import { PrismaClient } from "@prisma/client";

import { compile } from "./compile.mjs";

const prisma = new PrismaClient();

/** The post the client pointed at as ground truth, plus the recent corpus. */
const REFERENCE_SLUG = "vegan-tamale-pie";
const CORPUS_SIZE = 6;

/** Metrics where being far from the reference is the whole complaint. */
const HEADLINE = [
  "meanSentenceWords",
  "sentenceWordsStdev",
  "shortSentenceShare",
  "longSentenceShare",
  "meanParagraphSentences",
  "singleSentenceParagraphShare",
  "longParagraphShare",
  "parentheticals",
  "secondPerson",
  "firstPerson",
  "questions",
  "exclamations",
  "properNounRuns",
  "slang",
  "genericFoodAdjectives",
  "flatOpeningShare",
  "openingVariety",
];

function bar(value, reference) {
  if (reference === 0) return value === 0 ? "" : "  (none in corpus)";
  const ratio = value / reference;
  if (ratio >= 0.75 && ratio <= 1.33) return "  ok";
  return ratio < 1
    ? `  ${(ratio * 100).toFixed(0)}% of reference`
    : `  ${ratio.toFixed(1)}x reference`;
}

async function main() {
  const built = compile(["lib/drafter/style-metrics.ts"], { prefix: ".stylegap-" });
  const { measureProse, averageMetrics } = await built.load(
    "lib/drafter/style-metrics.ts",
  );

  const articleId = process.argv[2];
  const article =
    articleId !== undefined
      ? await prisma.article.findUnique({
          where: { id: articleId },
          select: { id: true, title: true, content: true, projectId: true },
        })
      : await prisma.article.findFirst({
          where: { mode: "drafter", content: { not: "" } },
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, content: true, projectId: true },
        });

  if (article === null) throw new Error("No drafted article to measure.");

  const reference = await prisma.wpPost.findFirst({
    where: { projectId: article.projectId, slug: REFERENCE_SLUG },
    select: { title: true, content: true },
  });

  const recent = await prisma.wpPost.findMany({
    where: { projectId: article.projectId, status: "publish", type: "post" },
    orderBy: { publishedAt: "desc" },
    take: CORPUS_SIZE,
    select: { title: true, content: true },
  });

  const corpus = [...(reference ? [reference] : []), ...recent];
  const corpusMetrics = corpus.map((p) => measureProse(p.content));
  const profile = averageMetrics(corpusMetrics);
  const draft = measureProse(article.content);

  console.log(`\nReference corpus (${corpus.length} published posts)`);
  for (const post of corpus) console.log(`   ${post.title.slice(0, 60)}`);

  if (reference !== null) {
    const solo = measureProse(reference.content);
    console.log(`\nGround truth: ${reference.title}`);
    console.log(
      `   ${solo.words} words · ${solo.paragraphs} paragraphs · ${solo.meanParagraphSentences} sentences per paragraph`,
    );
  }

  console.log(`\nDraft: ${article.title}`);
  console.log(
    `   ${draft.words} words · ${draft.paragraphs} paragraphs · ${draft.meanParagraphSentences} sentences per paragraph`,
  );

  console.log("\n" + "metric".padEnd(30) + "corpus".padStart(9) + "draft".padStart(9));
  console.log("-".repeat(70));
  for (const key of HEADLINE) {
    const ref = profile[key];
    const got = draft[key];
    console.log(
      key.padEnd(30) +
        String(ref).padStart(9) +
        String(got).padStart(9) +
        bar(got, ref),
    );
  }

  built.cleanup();
}

await main()
  .catch((err) => {
    console.error("\n", err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
