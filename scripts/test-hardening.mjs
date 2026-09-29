/**
 * Pure-function tests for live/estimated merge, SSRF host checks, rank-alert
 * copy, and the spend cap. No database.
 *
 *   node scripts/test-hardening.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const scratch = join(ROOT, ".tmp");
mkdirSync(scratch, { recursive: true });
const out = mkdtempSync(join(scratch, "hardening-"));

const SOURCES = [
  "lib/keywords/apply-live-metrics.ts",
  "lib/keywords/types.ts",
  "lib/keywords/estimate.ts",
  "lib/security/private-host.ts",
  "lib/alerts-logic.ts",
  "lib/spend-cap.ts",
];

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      types: [],
      baseUrl: ROOT,
      paths: { "@/*": ["./*"] },
      outDir: out,
      rootDir: ROOT,
    },
    files: SOURCES.map((s) => join(ROOT, s)),
  }),
);

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

try {
  execFileSync("npx", ["tsc", "-p", `"${join(out, "tsconfig.json")}"`], {
    stdio: "pipe",
    shell: true,
  });
} catch (err) {
  console.error("tsc failed:\n" + String(err.stdout ?? err));
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

function emitted(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...emitted(path));
    else if (entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

const files = emitted(out);
const href = (suffix) => {
  const hit = files.find((f) => f.replaceAll("\\", "/").endsWith(suffix));
  if (!hit) throw new Error(`missing emit for ${suffix}`);
  return pathToFileURL(hit).href;
};

const { applyLiveMetrics } = await import(href("apply-live-metrics.js"));
const { estimateKeyword } = await import(href("estimate.js"));
const { isBlockedHostname, assertHttpUrl } = await import(href("private-host.js"));
const { classifyRankMovement, alertCopy } = await import(href("alerts-logic.js"));
const { parseDailyCapUsd, spendWouldExceed } = await import(href("spend-cap.js"));

const est = estimateKeyword("vegan cinnamon rolls", "us");

console.log("\nLive vs estimated merge");
const none = applyLiveMetrics(est, undefined);
check(none.metricsSource === "estimated", "no API row stays estimated");
check(none.volume === est.volume, "estimated volume is kept when live is missing");

const live = applyLiveMetrics(est, {
  searchVolume: 5400,
  cpc: 1.2,
  competition: 0.4,
  difficulty: 33,
  trend: null,
  results: 1_200_000,
});
check(live.metricsSource === "live", "any live metric marks the row live");
check(live.volume === 5400, "live search volume wins");
check(live.trend.length === 12, "missing live trend keeps the 12-point estimate");

const emptyLive = applyLiveMetrics(est, {
  searchVolume: null,
  cpc: null,
  competition: null,
  difficulty: null,
  trend: null,
  results: null,
});
check(
  emptyLive.metricsSource === "estimated",
  "an empty DFS row is still estimated, not fake-live",
);

console.log("\nSSRF host checks");
check(isBlockedHostname("localhost") === true, "localhost is blocked");
check(isBlockedHostname("127.0.0.1") === true, "loopback IPv4 is blocked");
check(isBlockedHostname("10.1.2.3") === true, "RFC1918 10/8 is blocked");
check(isBlockedHostname("192.168.0.9") === true, "RFC1918 192.168/16 is blocked");
check(isBlockedHostname("facebook.com") === false, "facebook.com is not treated as unique-local IPv6");
check(isBlockedHostname("example.com") === false, "public hostnames pass");
check(isBlockedHostname("fc00::1") === true, "unique-local IPv6 is blocked");
try {
  assertHttpUrl("https://user:pass@example.com/");
  check(false, "URLs with credentials are rejected");
} catch {
  check(true, "URLs with credentials are rejected");
}
check(assertHttpUrl("https://example.com/path").hostname === "example.com", "https public URL parses");

console.log("\nRank movement");
check(classifyRankMovement(4, 12) === "drop", "5+ place drop");
check(classifyRankMovement(20, 8) === "gain", "5+ place gain");
check(classifyRankMovement(7, 9) === null, "2-place move is noise");
check(classifyRankMovement(11, null) === "lost", "left the top 100");
check(classifyRankMovement(null, 3) === "gain", "new top-10 appearance");
check(classifyRankMovement(null, 40) === null, "new #40 is not an alert");
check(
  alertCopy({ keyword: "pie", kind: "drop", previousRank: 4, currentRank: 12 }).includes("4") &&
    alertCopy({ keyword: "pie", kind: "drop", previousRank: 4, currentRank: 12 }).includes("12"),
  "drop copy names both ranks",
);

console.log("\nSpend cap");
check(parseDailyCapUsd(undefined) === 25, "default cap is $25");
check(parseDailyCapUsd("0") === 25, "zero falls back to default");
check(parseDailyCapUsd("abc") === 25, "garbage falls back to default");
check(parseDailyCapUsd("40") === 40, "valid override is used");
check(spendWouldExceed(24.5, 0.6, 25) === true, "at-or-over cap blocks");
check(spendWouldExceed(10, 1, 25) === false, "under cap allows");

rmSync(out, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "OK" : "FAILED"}  ${String(failures)} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
