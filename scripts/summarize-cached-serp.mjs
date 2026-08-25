/**
 * Summarize a cached SerpApi organic SERP for offline comparison.
 * Never prints credentials.
 *
 *   node --env-file-if-exists=.env.local scripts/summarize-cached-serp.mjs "vegan italian sausage"
 */
import { PrismaClient } from "@prisma/client";

const keyword = (process.argv[2] ?? "vegan italian sausage").toLowerCase();
const country = process.argv[3] ?? "us";
const prisma = new PrismaClient();

const row = await prisma.serpCache.findUnique({
  where: {
    engine_query_country: { engine: "google", query: keyword, country },
  },
});

if (!row) {
  console.log(`No cached SerpApi google SERP for "${keyword}" (${country}).`);
  await prisma.$disconnect();
  process.exit(0);
}

const payload = row.payload;
const organic = Array.isArray(payload?.organic_results)
  ? payload.organic_results
  : [];
const paa = Array.isArray(payload?.related_questions)
  ? payload.related_questions.map((q) => q.question).filter(Boolean)
  : [];
const related = Array.isArray(payload?.related_searches)
  ? payload.related_searches.map((s) => s.query).filter(Boolean)
  : [];

console.log(`Cached SerpApi SERP: "${keyword}" (${country})`);
console.log(`Fetched: ${row.fetchedAt.toISOString()}`);
console.log(`Organic: ${organic.length}`);
organic.slice(0, 10).forEach((r, i) => {
  let host = "";
  try {
    host = new URL(r.link ?? "").hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  console.log(
    `  ${String(r.position ?? i + 1).padStart(2)}. ${host} — ${(r.title ?? "").slice(0, 70)}`,
  );
});
console.log(`PAA: ${paa.length}${paa[0] ? ` (e.g. ${paa[0]})` : ""}`);
console.log(
  `Related: ${related.length}${related[0] ? ` (e.g. ${related[0]})` : ""}`,
);
console.log(
  `Features present: ${[
    organic.length ? "organic" : null,
    paa.length ? "people_also_ask" : null,
    related.length ? "related_searches" : null,
    payload?.ai_overview ? "ai_overview" : null,
    payload?.knowledge_graph ? "knowledge_graph" : null,
  ]
    .filter(Boolean)
    .join(", ")}`,
);

await prisma.$disconnect();
