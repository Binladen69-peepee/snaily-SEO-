/**
 * Round-trip proof for the Gutenberg parser.
 *
 * Every populated post starts as a byte-for-byte copy of the client's real
 * template, so the parser has to be lossless before anything is built on it.
 * This parses and re-serialises the template and every synced post, and reports
 * the first character that differs.
 *
 *   node --env-file=.env.local scripts/test-blocks.mjs
 */
import { PrismaClient } from "@prisma/client";

import { compile } from "./compile.mjs";

const built = compile(["lib/wordpress/blocks.ts"], { prefix: ".blocktest-" });
const B = await built.load("lib/wordpress/blocks.ts");

const prisma = new PrismaClient();

function firstDiff(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : len;
}

let failed = 0;

try {
  const rows = await prisma.wpPost.findMany({
    select: { wpId: true, title: true, content: true },
  });

  let checked = 0;

  for (const row of rows) {
    if (row.content.trim() === "") continue;
    checked += 1;

    const out = B.serializeBlocks(B.parseBlocks(row.content));
    if (out === row.content) continue;

    failed += 1;
    const at = firstDiff(row.content, out);
    console.log(`\nFAIL  ${row.wpId}  ${row.title}`);
    console.log(`  differs at ${at} of ${row.content.length}`);
    console.log(`  expected ${JSON.stringify(row.content.slice(Math.max(0, at - 60), at + 60))}`);
    console.log(`  actual   ${JSON.stringify(out.slice(Math.max(0, at - 60), at + 60))}`);
    if (failed >= 5) break;
  }

  console.log(
    `\n${checked - failed}/${checked} synced posts round-tripped byte for byte.`,
  );

  const template = rows.find((r) => r.wpId === 37284);
  if (template) {
    const tree = B.parseBlocks(template.content);
    const counts = {};
    for (const b of B.flattenBlocks(tree)) {
      if (b.name === "") continue;
      counts[b.name] = (counts[b.name] ?? 0) + 1;
    }
    console.log("\nBlog Post Template block census:");
    for (const [name, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${name}`);
    }
  }
} finally {
  await prisma.$disconnect();
  built.cleanup();
}

process.exit(failed === 0 ? 0 : 1);
