/**
 * Checks the alpha-3 → alpha-2 country table.
 *
 * The table is hand-written data, which is exactly the kind of thing that
 * silently rots: a transposed pair mislabels a country's traffic rather than
 * failing loudly. These checks make a typo a build failure instead.
 *
 * Run: npm run test:countries
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "lib", "countries.ts"), "utf8");

const table = /ALPHA3_TO_ALPHA2_TABLE = `([\s\S]*?)`/.exec(source)?.[1];
if (table === undefined) {
  console.error("FAIL  could not find ALPHA3_TO_ALPHA2_TABLE in lib/countries.ts");
  process.exit(1);
}

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

// Non-ASCII is the failure mode that looks fine and breaks everything: a
// Cyrillic "а" reads identically to a Latin "a" but never matches a lookup.
const nonAscii = [...table].filter((c) => c.charCodeAt(0) > 127);
check(
  nonAscii.length === 0,
  `table contains ${String(nonAscii.length)} non-ASCII character(s): ${[
    ...new Set(nonAscii),
  ]
    .map((c) => `U+${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .join(", ")}`,
);

const tokens = table.trim().split(/\s+/);
check(tokens.length % 2 === 0, `odd token count (${String(tokens.length)})`);

const names = new Intl.DisplayNames(["en"], { type: "region" });
const seenAlpha3 = new Set();
const seenAlpha2 = new Map();
let pairs = 0;

for (let i = 0; i + 1 < tokens.length; i += 2) {
  const a3 = tokens[i];
  const a2 = tokens[i + 1];
  pairs += 1;

  check(/^[a-z]{3}$/.test(a3), `"${a3}" is not three lowercase letters`);
  check(/^[A-Z]{2}$/.test(a2), `"${a2}" (for ${a3}) is not two uppercase letters`);
  check(!seenAlpha3.has(a3), `duplicate alpha-3 "${a3}"`);
  check(
    !seenAlpha2.has(a2),
    `alpha-2 "${a2}" used twice: ${String(seenAlpha2.get(a2))} and ${a3}`,
  );
  seenAlpha3.add(a3);
  seenAlpha2.set(a2, a3);

  // An unknown region code comes back unchanged, which is how a made-up
  // alpha-2 gives itself away.
  let resolved = a2;
  try {
    resolved = names.of(a2) ?? a2;
  } catch {
    resolved = a2;
  }
  check(resolved !== a2, `alpha-2 "${a2}" (for ${a3}) is not a known region`);

  // The first letter almost always matches between the two codes. The
  // exceptions are real and few, so they are listed rather than ignored —
  // anything else that trips this is a transposition.
  const KNOWN_MISMATCH = new Set([
    "ala", "bes", "che", "cod", "com", "cpv", "deu", "esh", "gnb", "grd",
    "kna", "khm", "lca", "mac", "myt", "prk", "sgs", "spm", "srb", "vct",
    "zaf", "twn", "tls", "vgb", "vir", "wlf", "cym", "cck", "hkg", "mne",
    "mkd", "svk", "svn", "sxm", "syc", "ssd", "stp", "shn", "sjm", "pse",
    "pyf", "phl", "nld", "mmr", "mnp", "mhl", "mdv", "lva", "ltu", "irl",
    "isr", "isl", "imn", "guf", "glp", "gtm", "flk", "fro", "fsm", "est",
    "dnk", "dza", "cri", "chn", "bvt", "brb", "blm", "atf", "ata", "asm",
    "and", "abw", "umi", "vut", "wsm", "zwe", "zmb", "yem", "tuv", "tkl",
    "tca", "sur", "slb", "sle", "slv", "smr", "som", "swz", "swe", "tza",
  ]);
  check(
    a3[0] === a2[0].toLowerCase() || KNOWN_MISMATCH.has(a3),
    `"${a3}" → "${a2}" looks transposed (first letters differ, not a listed exception)`,
  );
}

check(pairs >= 240, `only ${String(pairs)} countries mapped; expected 240+`);

// A handful of spot checks the rest of the app actually depends on.
const SPOT = [
  ["usa", "US", "United States"],
  ["gbr", "GB", "United Kingdom"],
  ["deu", "DE", "Germany"],
  ["fra", "FR", "France"],
  ["can", "CA", "Canada"],
  ["ind", "IN", "India"],
  ["aus", "AU", "Australia"],
  ["nld", "NL", "Netherlands"],
  ["zaf", "ZA", "South Africa"],
  ["jpn", "JP", "Japan"],
];
for (const [a3, expectedA2, expectedName] of SPOT) {
  const got = seenAlpha3.has(a3) ? tokens[tokens.indexOf(a3) + 1] : null;
  check(got === expectedA2, `${a3} should map to ${expectedA2}, got ${String(got)}`);
  if (got === expectedA2) {
    check(
      names.of(got) === expectedName,
      `${a3} → ${got} should be named "${expectedName}", got "${String(names.of(got))}"`,
    );
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${String(failures.length)} failure(s)`);
  process.exit(1);
}

console.log(`PASS  ${String(pairs)} country codes, all resolvable and unique`);
