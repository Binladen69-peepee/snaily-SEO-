/**
 * Link picker suggestions, against the project's real data.
 *
 * The picker offers two things that must never be confused: the author's own
 * posts, which are ordinary dofollow links, and ingredient links from their
 * sheet, which are affiliate URLs and have to go out marked sponsored. This
 * exercises the ranking and the rel decision on real rows.
 *
 *   node --env-file=.env.local scripts/test-link-picker.mjs
 */
import { PrismaClient } from "@prisma/client";

import { checker, compile } from "./compile.mjs";

const built = compile(["lib/db.ts", "lib/content/link-index.ts"], {
  prefix: ".pickertest-",
});
const LinkIndex = await built.load("lib/content/link-index.ts");

const prisma = new PrismaClient();
const t = checker();

const PROJECT = "cmsj6ec0g0001jw045lu5uqjo";

/** Mirrors the ranking in app/api/articles/[id]/links/route.ts. */
function suggest(query, index, affiliates) {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 1);

  const score = (haystack, terms, slug) => {
    const text = haystack.toLowerCase();
    let n = 0;
    if (text.startsWith(q)) n += 100;
    else if (text.includes(q)) n += 60;
    n += words.filter((w) => terms.includes(w)).length * 10;
    if (slug !== "" && slug.includes(q.replace(/\s+/g, "-"))) n += 20;
    return n;
  };

  const pages = index.all
    .map((target) => ({
      s: { title: target.title, url: target.url, kind: "internal" },
      score: score(target.title, target.terms, target.slug),
    }))
    .filter((r) => r.score > 0);

  const products = affiliates
    .map((row) => ({
      s: {
        title: row.term,
        url: row.url,
        kind: "affiliate",
        ...(row.kind === "affiliate"
          ? { rel: "sponsored nofollow", target: "_blank" }
          : {}),
      },
      score: score(row.term, row.term.split(/\s+/), ""),
    }))
    .filter((r) => r.score > 0);

  const byScore = (a, b) => b.score - a.score || a.s.title.length - b.s.title.length;

  return [
    ...pages.sort(byScore).slice(0, 8),
    ...products.sort(byScore).slice(0, 6),
  ].map((r) => r.s);
}

let failures = 0;

try {
  const index = await LinkIndex.buildLinkIndex(PROJECT);
  const affiliates = await prisma.affiliateLink.findMany({
    where: { projectId: PROJECT, enabled: true },
    select: { term: true, url: true, kind: true },
  });

  t.section("Typing a recipe name");
  const hummus = suggest("hummus", index, affiliates);
  t.check(
    hummus.some((s) => s.kind === "internal" && /hummus/i.test(s.title)),
    `"hummus" suggests real posts (${hummus.filter((s) => s.kind === "internal").length})`,
  );
  t.check(
    hummus
      .filter((s) => s.kind === "internal")
      .every((s) => s.url.startsWith("https://cinnamonsnail.com/")),
    "every post suggestion is a real published URL",
  );
  t.check(
    hummus.filter((s) => s.kind === "internal").every((s) => s.rel === undefined),
    "post links carry no rel, so they keep their internal link equity",
  );

  t.section("Typing an ingredient");
  const paprika = suggest("smoked paprika", index, affiliates);
  const product = paprika.find((s) => s.kind === "affiliate");
  t.check(product !== undefined, `"smoked paprika" suggests a product link`);
  t.check(
    product?.rel === "sponsored nofollow",
    "the product link is marked rel=\"sponsored nofollow\"",
  );
  t.check(product?.target === "_blank", "and opens in a new tab");
  const sheetRow = affiliates.find((a) => a.term === product?.title);
  t.check(
    sheetRow !== undefined && sheetRow.url === product?.url,
    "the URL is the sheet's URL, byte for byte",
  );

  t.section("Partial words, as the author types");
  for (const [typed, expected] of [
    ["chan", "chana"],
    ["tahi", "tahini"],
    ["baz", "bazlama"],
  ]) {
    const hits = suggest(typed, index, affiliates);
    t.check(
      hits.some((s) => s.title.toLowerCase().includes(expected)),
      `"${typed}" already suggests something matching "${expected}" (${hits.length} results)`,
    );
  }

  t.section("Own-site rows in the sheet stay dofollow");
  const internalRows = affiliates.filter((a) => a.kind === "internal");
  if (internalRows.length > 0) {
    const sample = suggest(internalRows[0].term, index, affiliates);
    const row = sample.find(
      (s) => s.kind === "affiliate" && s.title === internalRows[0].term,
    );
    t.check(
      row !== undefined && row.rel === undefined,
      `"${internalRows[0].term}" points at the author's own site and stays dofollow`,
    );
  } else {
    t.check(false, "the sheet has at least one own-site row");
  }

  t.section("Nothing is invented");
  const nonsense = suggest("zzzzqqqx", index, affiliates);
  t.check(nonsense.length === 0, "a query matching nothing suggests nothing");

  failures = t.report();
} finally {
  await prisma.$disconnect();
  built.cleanup();
}

process.exit(failures === 0 ? 0 : 1);
