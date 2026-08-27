/**
 * A typeset mention still matches its plain-ASCII post title.
 *
 * Post titles are stored as plain ASCII; the prose that names them is typeset.
 * "Super-Crispy Batata Harra Recipe" is a published post on the client's site,
 * and a draft naming it wrote a NON-BREAKING hyphen instead of a plain one.
 * A different character, so the literal search matched nothing and that
 * mention went unlinked while its neighbours in the same sentence linked fine
 * — which is exactly the inconsistency the client reported.
 *
 *   npm run test:link-typography
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

// Built from code points so no escaping in this file can misrepresent them.
const ch = (c) => String.fromCodePoint(c);
const NB_HYPHEN = ch(0x2011);
const EN_DASH = ch(0x2013);
const NBSP = ch(0x00a0);
const CURLY = ch(0x2019);

const built = compile(["lib/content/html-runs.ts"], { prefix: ".linktypo-" });

try {
  const { findTermMatch } = await built.load("lib/content/html-runs.ts");

  console.log("\nThe client's exact case");
  const real = findTermMatch(
    `<p>set out a mini buffet: a bowl of Super${NB_HYPHEN}Crispy Batata Harra, a side of hummus.</p>`,
    "Super-Crispy Batata Harra Recipe".replace(" Recipe", ""),
  );
  check(real !== null, "a non-breaking hyphen still matches a plain-hyphen title");
  check(
    real?.text.includes(NB_HYPHEN) === true,
    "and the anchor keeps the character the prose actually used",
    JSON.stringify(real?.text),
  );

  console.log("\nOther typography prose introduces");
  for (const [html, term, label] of [
    [`<p>try the Vegan${NBSP}Taco Soup today</p>`, "Vegan Taco Soup", "a non-breaking space"],
    [`<p>Adam${CURLY}s Chili is great</p>`, "Adam's Chili", "a curly apostrophe"],
    [`<p>the Sweet${EN_DASH}Spicy Bowl is here</p>`, "Sweet-Spicy Bowl", "an en dash"],
    ["<p>a slice of Bazlama (Turkish Flatbread Recipe) is nice</p>",
      "Bazlama (Turkish Flatbread Recipe)", "parentheses in the title"],
    ["<p>with roasted red pepper hummus for crunch</p>",
      "Roasted Red Pepper Hummus", "a case difference"],
  ]) {
    check(findTermMatch(html, term) !== null, label);
  }

  console.log("\nAnd it is no looser than before");
  check(
    findTermMatch("<p>we love tamarind paste</p>", "Tamari") === null,
    "a term inside a longer word is still refused",
  );
  check(
    findTermMatch("<p>a <a href='/x'>linked thing</a> here</p>", "linked thing") === null,
    "text already inside an anchor is not matched again",
  );
  check(
    findTermMatch("<p>nothing relevant here</p>", "Vegan Taco Soup") === null,
    "an absent term matches nothing",
  );
  check(
    findTermMatch("<h2>Vegan Taco Soup</h2><p>x</p>", "Vegan Taco Soup") === null,
    "a heading is not a place to put a link",
  );
} finally {
  built.cleanup();
}

console.log(
  failures === 0 ? "\nAll link-typography checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
