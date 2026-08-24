/**
 * Regression test for folding SERP snapshots back into Deep Dive rows.
 *
 * The bug this pins: the enrich endpoint lowercases every keyword before using
 * it as a result key, so a row that kept its original casing never matched and
 * its columns stayed empty with no error. With most rows in a batch failing to
 * match, it looked like "only the last row gets its data".
 *
 *   node scripts/test-merge.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, ".mergetest-"));
const SOURCES = ["lib/keywords/merge-snapshots.ts"];

writeFileSync(join(out, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    strict: false, skipLibCheck: true, types: [],
    baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: out, rootDir: ROOT,
  },
  files: SOURCES.map((s) => join(ROOT, s)),
}));

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

try {
  execFileSync("npx", ["tsc", "-p", `"${join(out, "tsconfig.json")}"`], { stdio: "pipe", shell: true });
} catch (err) {
  console.error("tsc failed:\n" + String(err.stdout ?? err));
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

const { mergeSnapshots, missingSnapshots } = await import(
  pathToFileURL(join(out, "lib/keywords/merge-snapshots.js")).href
);

const snap = (da) => ({ difficulty: da, da3: da, estLinks: 1, pages: [] });
const row = (keyword, difficulty = 50, serp = null) => ({ keyword, difficulty, serp });

try {
  console.log("\nEvery row in a batch is applied");
  const rows = [row("alpha"), row("bravo"), row("charlie"), row("delta")];
  const merged = mergeSnapshots(rows, {
    alpha: snap(10), bravo: snap(20), charlie: snap(30), delta: snap(40),
  });
  check(merged.filter((r) => r.serp !== null).length === 4, "all four rows get their snapshot");
  check(merged[0].serp.da3 === 10 && merged[3].serp.da3 === 40, "each row gets its own, not the last one's");

  console.log("\nCase folding — the actual bug");
  const mixed = [row("Superman Cost To Make"), row("How Build Super Man"), row("plain lower")];
  const m2 = mergeSnapshots(mixed, {
    "superman cost to make": snap(61),
    "how build super man": snap(28),
    "plain lower": snap(44),
  });
  check(m2[0].serp !== null, "a Title Case row matches a lowercased result key");
  check(m2[1].serp !== null, "a second Title Case row also matches");
  check(m2[2].serp !== null, "an already-lowercase row still matches");
  check(m2[0].serp.da3 === 61 && m2[1].serp.da3 === 28, "matched rows keep their own values");

  console.log("\nWhitespace");
  const m3 = mergeSnapshots([row("  spaced out  ")], { "spaced out": snap(7) });
  check(m3[0].serp !== null, "surrounding whitespace does not defeat the match");

  console.log("\nMisses are left alone");
  const m4 = mergeSnapshots([row("kept", 55), row("hit", 55)], { hit: snap(12), other: snap(99) });
  check(m4[0].serp === null && m4[0].difficulty === 55, "a row with no result is untouched");
  check(m4[1].difficulty === 12, "a measured difficulty replaces the estimate");
  check(m4.length === 2, "unrelated result keys do not add rows");

  console.log("\nNulls");
  const m5 = mergeSnapshots([row("nope", 33)], { nope: null });
  check(m5[0].serp === null && m5[0].difficulty === 33, "an explicit null result leaves the row unfetched");

  const m6 = mergeSnapshots([row("keepdiff", 33)], { keepdiff: { difficulty: null } });
  check(m6[0].serp !== null && m6[0].difficulty === 33, "a snapshot with no difficulty keeps the estimate");

  console.log("\nmissingSnapshots");
  const mixedRows = [row("a", 50, snap(1)), row("b"), row("c", 50, snap(2)), row("d")];
  const missing = missingSnapshots(mixedRows);
  check(missing.length === 2 && missing[0] === "b" && missing[1] === "d", "reports only unfetched rows, in order");

  console.log("\nImmutability");
  const original = [row("x")];
  const copy = mergeSnapshots(original, { x: snap(5) });
  check(original[0].serp === null, "the input array is not mutated");
  check(copy !== original, "a new array is returned");
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll snapshot-merge checks passed.");
