/**
 * Loads the author's ingredient → affiliate URL sheet into a project.
 *
 * The app imports the same file through the Ingredient Links screen; this is
 * the same parser and the same rules, for seeding a project from the command
 * line so the export tests have real affiliate data to match against.
 *
 *   node --env-file=.env.local scripts/import-ingredients.mjs "<path to csv>" [projectId]
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { compile } from "./compile.mjs";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node --env-file=.env.local scripts/import-ingredients.mjs <csv> [projectId]");
  process.exit(1);
}

const built = compile(["lib/content/affiliate.ts", "lib/db.ts"], {
  prefix: ".importaff-",
});
const A = await built.load("lib/content/affiliate.ts");

const prisma = new PrismaClient();

try {
  const projects = process.argv[3]
    ? await prisma.project.findMany({
        where: { id: process.argv[3] },
        select: { id: true, name: true, url: true },
      })
    : await prisma.project.findMany({ select: { id: true, name: true, url: true } });

  const csv = readFileSync(csvPath, "utf8");

  for (const project of projects) {
    let siteHost = "";
    try {
      siteHost = new URL(project.url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      /* A project without a parseable URL simply has no "internal" class. */
    }

    const { terms, skippedNoUrl, skippedBadUrl } = A.parseAffiliateCsv(csv, siteHost);

    const previous = await prisma.affiliateLink.findMany({
      where: { projectId: project.id, enabled: false },
      select: { term: true },
    });
    const disabled = new Set(previous.map((p) => p.term));

    await prisma.affiliateLink.deleteMany({ where: { projectId: project.id } });

    const rows = terms.map((t) => ({
      projectId: project.id,
      term: t.term,
      words: t.words,
      category: t.category,
      url: t.url,
      kind: t.kind,
      enabled: !A.GENERIC_TERMS.has(t.term) && !disabled.has(t.term),
    }));

    for (let i = 0; i < rows.length; i += 500) {
      await prisma.affiliateLink.createMany({
        data: rows.slice(i, i + 500),
        skipDuplicates: true,
      });
    }

    console.log(
      `${project.name} (${project.id})\n` +
        `  imported ${rows.length}, enabled ${rows.filter((r) => r.enabled).length}, ` +
        `affiliate ${rows.filter((r) => r.kind === "affiliate").length}, ` +
        `internal ${rows.filter((r) => r.kind === "internal").length}\n` +
        `  skipped ${skippedNoUrl} with no URL, ${skippedBadUrl} with an unusable one`,
    );
  }
} finally {
  await prisma.$disconnect();
  built.cleanup();
}
