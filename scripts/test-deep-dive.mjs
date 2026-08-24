/**
 * Deep Dive: sources, tab classification, and the shape of a real search.
 *
 * The suggestion endpoints are hit for real — they are free and they are the
 * whole point of the feature, so a test that mocked them would prove nothing.
 * Nothing here spends SerpApi quota: the `related` and `competitors` sources
 * and the enrichment path are exercised separately, on purpose.
 *
 *   node --env-file=.env.local scripts/test-deep-dive.mjs
 */
import { PrismaClient } from "@prisma/client";

import { checker, compile } from "./compile.mjs";

const SOURCES = [
  "lib/db.ts",
  "lib/keywords/types.ts",
  "lib/keywords/estimate.ts",
  "lib/keywords/intent-tabs.ts",
  "lib/keywords/suggest-sources.ts",
];

const built = compile(SOURCES, { prefix: ".ddtest-" });
const Suggest = await built.load("lib/keywords/suggest-sources.ts");
const Tabs = await built.load("lib/keywords/intent-tabs.ts");

const prisma = new PrismaClient();
const t = checker();

let failures = 0;

try {
  /* ---------------------------------------------------------------- */
  t.section("Source registry");

  const available = Suggest.SOURCES.filter((s) => s.available);
  const unavailable = Suggest.SOURCES.filter((s) => !s.available);

  t.check(
    Suggest.SOURCES.length === 11,
    `${Suggest.SOURCES.length} sources listed`,
  );
  t.check(
    available.length === 8,
    `${available.length} are actually reachable: ${available.map((s) => s.label).join(", ")}`,
  );
  t.check(
    unavailable.every((s) => typeof s.reason === "string" && s.reason.length > 20),
    `every unavailable source explains itself: ${unavailable.map((s) => s.label).join(", ")}`,
  );

  /* ---------------------------------------------------------------- */
  t.section("Live autocomplete endpoints");

  const live = ["google", "bing", "youtube", "duckduckgo", "amazon", "ebay"];
  const got = {};

  for (const source of live) {
    const phrases = await Suggest.fetchSuggestions(source, "affirmation cards", "us");
    got[source] = phrases;
    t.check(
      phrases.length > 0,
      `${source} returned ${phrases.length} phrases (e.g. "${phrases[0] ?? ""}")`,
    );
    t.check(
      phrases.every((p) => typeof p === "string" && p === p.toLowerCase().trim()),
      `${source} phrases are normalised`,
    );
  }

  t.check(
    new Set([...got.google, ...got.bing]).size > got.google.length,
    "different engines contribute different phrases, so combining them is worth it",
  );

  t.section("Caching");
  const before = await prisma.serpCache.count({
    where: { engine: { startsWith: "suggest_" } },
  });
  await Suggest.fetchSuggestions("google", "affirmation cards", "us");
  const after = await prisma.serpCache.count({
    where: { engine: { startsWith: "suggest_" } },
  });
  t.check(before === after, `a repeat search adds no cache rows (${after} cached)`);

  /* ---------------------------------------------------------------- */
  t.section("Alphabet expansion");

  const narrow = await Suggest.fetchSuggestions("google", "block island beach", "us");
  const wide = await Suggest.expandSuggestions(
    "google",
    "block island beach",
    "us",
    "abcde",
  );
  t.check(
    wide.length > narrow.length,
    `expansion widens ${narrow.length} phrases to ${wide.length}`,
  );
  t.check(
    narrow.every((p) => wide.includes(p)),
    "the plain results are a subset of the expanded ones",
  );

  /* ---------------------------------------------------------------- */
  t.section("Tab classification");

  const cases = [
    ["how do affirmation cards work", "questions", true],
    ["what are affirmation cards", "questions", true],
    ["affirmation cards", "questions", false],
    ["best affirmation cards", "purchase", true],
    ["affirmation cards price", "purchase", true],
    ["cheap affirmation cards for women", "purchase", true],
    ["affirmation cards", "purchase", false],
    ["affirmation cards vs tarot cards", "comparison", true],
    ["difference between affirmation and tarot cards", "comparison", true],
    ["affirmation cards", "comparison", false],
    ["affirmation cards near me", "local", true],
    ["affirmation cards delivery", "local", true],
    ["affirmation cards", "local", false],
    ["free printable affirmation cards pdf", "longtail", true],
    ["affirmation cards for women", "longtail", true],
    ["affirmation cards", "longtail", false],
  ];

  for (const [keyword, tab, expected] of cases) {
    t.check(
      Tabs.matchesTab(keyword, tab) === expected,
      `"${keyword}" ${expected ? "is" : "is not"} ${tab}`,
    );
  }

  t.section("Recipe vocabulary is not mistaken for local intent");
  for (const keyword of [
    "vegan hummus in the oven",
    "blend chickpeas in a blender",
    "roast beets in foil",
  ]) {
    t.check(!Tabs.isLocal(keyword), `"${keyword}" is not local`);
  }

  t.section("Tab counts");
  const rows = cases.map(([keyword]) => ({ keyword }));
  const counts = Tabs.countTabs(rows);
  t.check(counts.all === rows.length, `all = ${counts.all}`);
  t.check(counts.questions > 0 && counts.purchase > 0, "counts are populated");
  t.check(
    Object.entries(counts).every(([, n]) => n <= counts.all),
    "no tab counts more rows than exist",
  );

  const filtered = Tabs.filterByTab(rows, "questions");
  t.check(
    filtered.length === counts.questions,
    `filtering agrees with the count (${filtered.length})`,
  );

  failures = t.report();
} finally {
  await prisma.$disconnect();
  built.cleanup();
}

process.exit(failures === 0 ? 0 : 1);
