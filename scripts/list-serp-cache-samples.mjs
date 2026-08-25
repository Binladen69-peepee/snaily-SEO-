/**
 * List recent SerpCache rows for live-comparison candidates.
 * Never prints payload bodies or credentials.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const rows = await prisma.serpCache.findMany({
  where: {
    OR: [
      { query: { contains: "vegan" } },
      { query: { contains: "tamale" } },
      { query: { contains: "cinnamon" } },
      { query: { startsWith: "vegan" } },
    ],
  },
  orderBy: { fetchedAt: "desc" },
  take: 15,
  select: { engine: true, query: true, country: true, fetchedAt: true },
});

console.log(`Found ${rows.length} cached SERP row(s):`);
for (const r of rows) {
  console.log(
    `- ${r.engine} | ${r.country} | ${r.fetchedAt.toISOString()} | ${r.query.slice(0, 80)}`,
  );
}

const settings = await prisma.appSetting.findMany({
  where: {
    key: { in: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "SERPAPI_KEY"] },
  },
  select: { key: true },
});
console.log(
  "\nAppSetting keys present:",
  settings.map((s) => s.key).join(", ") || "(none)",
);

await prisma.$disconnect();
