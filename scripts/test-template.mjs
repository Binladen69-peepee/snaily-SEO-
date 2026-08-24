/**
 * End-to-end verification of the WordPress template export.
 *
 * Runs three real recipes through the whole path — internal links, ingredient
 * links, section mapping, step mapping, template population — against the
 * client's actual "Blog Post Template" post pulled from the synced mirror.
 *
 * Nothing here talks to WordPress. Every assertion is made on the markup that
 * *would* be posted, so the test can prove the original template is untouched
 * and that no publish can happen, without creating anything on the live site.
 *
 *   node --env-file=.env.local scripts/test-template.mjs
 */
import { PrismaClient } from "@prisma/client";

import { checker, compile } from "./compile.mjs";

const SOURCES = [
  "lib/db.ts",
  "lib/markdown.ts",
  "lib/text.ts",
  "lib/content/affiliate.ts",
  "lib/content/link-index.ts",
  "lib/drafter/editorial.ts",
  "lib/drafter/sanitize.ts",
  "lib/drafter/post-template.ts",
  "lib/wordpress/blocks.ts",
  "lib/wordpress/template.ts",
  "lib/wordpress/section-mapper.ts",
  "lib/wordpress/draft-export.ts",
  "lib/wordpress/client.ts",
  "lib/wordpress/plugin.ts",
];

const built = compile(SOURCES, { prefix: ".tpltest-" });
const Blocks = await built.load("lib/wordpress/blocks.ts");
const Template = await built.load("lib/wordpress/template.ts");
const Mapper = await built.load("lib/wordpress/section-mapper.ts");
const Affiliate = await built.load("lib/content/affiliate.ts");
const LinkIndex = await built.load("lib/content/link-index.ts");
const Markdown = await built.load("lib/markdown.ts");

const prisma = new PrismaClient();
const t = checker();

const PROJECT = "cmsj6ec0g0001jw045lu5uqjo";
const TEMPLATE_ID = 37284;

/* ---------------------------------------------------------------------------
 * Three drafts, in the format the Drafter produces
 * ------------------------------------------------------------------------ */

/** Links to real published posts, and several ingredients that are in the sheet. */
const BEET_HUMMUS = `
This vegan beet hummus turns an ordinary bowl of chickpeas into something the
colour of a sunset. It takes 20 minutes and one blender.

If you like this you will probably like my [Roasted Red Pepper Hummus](/roasted-red-pepper-hummus-recipe/)
and [Lemon Hummus](/lemon-hummus-recipe/) too.

## 🥰 Why you'll adore this beet hummus

- **Vegan AF:** no dairy, no honey, nothing that ever had a face.
- **One blender:** the whole thing happens in one bowl.
- **Tested and Approved Worldwide:** testers in three countries got it right.

## 🌶️ Ingredients for vegan beet hummus

Good tahini is the whole game here. Thin, pourable, not the concrete at the
bottom of an old jar.

A little sumac over the top at the end adds the tartness that beets need.
Chickpeas from a can are completely fine.

## 🤯 Variations

**Roasted garlic version.** Roast a whole head and blend it in, the way
[Beet Hummus With Roasted Garlic](/beet-hummus-recipe/) does.

**Extra lemony.** Double the juice and skip the sumac.

## 📖 How to make vegan beet hummus

No 47 overhead shots here. Scroll to the recipe card if you just want numbers.

### Roast the Beets

Wrap the beets in foil and roast at 400°F (205°C) for 50 minutes, until a
knife slides in with no resistance.

### Peel Them Warm

Rub the skins off under cold running water. They come away in sheets while the
beets are still warm and fight you once they cool.

### Blend the Base

Blend the chickpeas, tahini and lemon juice first, on their own, until the
mixture goes pale and thick.

### Add the Beets

Drop the beets in and blend again until the colour is even. Stop before it
turns into soup.

## 💡Serving Ideas

Serve it with [Bazlama (Turkish Flatbread Recipe)](/bazlama-recipe/) still warm
from the pan, or with [Za'atar Manakeesh](/zaatar-manakeesh-recipe/) cut into
strips.

It also holds its own next to [Super-Crispy Batata Harra Recipe](/batata-harra-recipe/)
and [Mujadara Recipe (Lebanese Rice and Brown Lentils)](/mujadara-recipe/).

## 👉Top tips

Roast, Do Not Boil: boiled beets go watery and the hummus never thickens.

Salt at the End: beets are sweeter than you think and salting early overshoots.

Let It Sit: an hour in the fridge and the flavour stops tasting like separate things.

## 🤷‍♀️ Recipe FAQs

### Can I use pre-cooked beets?

Yes, the vacuum-packed ones work. Pat them dry first or the hummus goes loose.

### How long does it keep?

Five days covered in the fridge. The colour deepens, which is fine.

### Can I freeze it?

Yes, in a sealed container for up to three months. Stir it hard after thawing.

## ✌️You'll love these too

- [Roasted Red Pepper Hummus](/roasted-red-pepper-hummus-recipe/)
- [Lemon Hummus (From Dried or Canned Chickpeas)](/lemon-hummus-recipe/)
- [Super-Crispy Batata Harra Recipe](/batata-harra-recipe/)
- [Mujadara Recipe (Lebanese Rice and Brown Lentils)](/mujadara-recipe/)
`.trim();

/** Affiliate-heavy: zaatar, sumac, olive oil, tahini all sit in the sheet. */
const MANAKEESH = `
Za'atar manakeesh is flatbread with a herb paste baked right into the top of it.

## 🥰 Why you'll adore these manakeesh

- **Vegan AF:** flour, water, oil, herbs. That is the whole list.
- **Tested and Approved Worldwide:** the dough is forgiving enough to survive testers.

## 🌶️ Ingredients for za'atar manakeesh

The zaatar blend is the point. Buy it somewhere that sells it fast, because
dried herbs go dusty and flat sitting on a shelf.

Good olive oil matters more here than anywhere else in the recipe. A little
sumac in the mix sharpens it.

## 📖 How to make za'atar manakeesh

### Mix the Dough

Combine the flour, yeast and water and knead for 8 minutes until smooth.

### Let It Rise

Cover and leave somewhere warm for 90 minutes, until doubled.

### Make the Paste

Stir the herbs into enough oil to make a loose, spoonable paste.

### Shape and Bake

Flatten each ball, spread the paste to the edge, and bake at 475°F (245°C) for
8 minutes.

## 💡Serving Ideas

Cut them into strips and serve alongside [Syrian Fattoush Salad Recipe](/fattoush-salad-recipe/).

## 👉Top tips

Do Not Skimp on Oil: a dry paste burns before the bread is cooked.

Preheat Properly: give the oven a full 25 minutes or the bread comes out pale.

## 🤷‍♀️ Recipe FAQs

### Can I make the dough ahead?

Yes. Refrigerate it overnight after the first rise and bring it back to room
temperature before shaping.

## ✌️You'll love these too

- [Bazlama (Turkish Flatbread Recipe)](/bazlama-recipe/)
- [Syrian Fattoush Salad Recipe](/fattoush-salad-recipe/)
`.trim();

/**
 * Deliberately free of anything in the affiliate sheet, and with a link to a
 * page that does not exist. Nothing should be linked in either direction.
 */
const FRUIT_SALAD = `
A bowl of cut fruit is not really a recipe, but people ask, so here it is.

## 🥰 Why you'll adore this fruit salad

- **Vegan AF:** it is fruit.
- **Tested and Approved Worldwide:** nobody has managed to get this wrong yet.

## 🌶️ Ingredients for summer fruit salad

Use whatever is ripe. Underripe fruit is the only way to ruin this.

## 📖 How to make summer fruit salad

### Cut Everything

Cut the fruit into pieces roughly the same size so no one piece dominates.

### Toss and Chill

Toss gently and chill for 20 minutes before serving.

## 💡Serving Ideas

Serve it with [My Imaginary Pancake Recipe](/imaginary-pancakes/) if you want
something warm alongside.

## 👉Top tips

Cut Late: fruit cut hours ahead weeps and goes soft.

## 🤷‍♀️ Recipe FAQs

### How long does it keep?

A day, maybe two. After that it is smoothie material.

## ✌️You'll love these too

- [Vegan Zucchini Muffins With ORange Olive Oil Streusel](/vegan-zucchini-muffins-recipe/)
`.trim();

/* ------------------------------------------------------------------------ */

let failures = 0;

try {
  const templateRow = await prisma.wpPost.findUnique({
    where: { projectId_wpId: { projectId: PROJECT, wpId: TEMPLATE_ID } },
    select: { wpId: true, title: true, status: true, content: true },
  });

  if (!templateRow) throw new Error(`Template post ${TEMPLATE_ID} is not synced.`);

  const ORIGINAL = templateRow.content;

  const affiliates = await Affiliate.buildAffiliateIndex(PROJECT);
  const links = await LinkIndex.buildLinkIndex(PROJECT);

  /* ---------------------------------------------------------------- */
  t.section("Template discovery");

  const candidates = await Template.findTemplateCandidates(PROJECT);
  t.check(candidates.length > 0, "at least one template candidate found");
  t.check(
    candidates[0]?.wpId === TEMPLATE_ID,
    `best candidate is "Blog Post Template" (${TEMPLATE_ID}), got ${candidates[0]?.wpId}`,
  );
  t.check(
    !candidates.some((c) => /class/i.test(c.title)),
    "class-page templates are not offered as blog post templates",
  );

  const resolved = await Template.resolveTemplate(PROJECT);
  t.check(resolved.wpId === TEMPLATE_ID, "resolveTemplate finds the same post");
  t.check(resolved.status === "draft", "the template itself is a draft");

  /* ---------------------------------------------------------------- */
  t.section("Template section index");

  const structure = Template.readStructure(ORIGINAL);
  const expected = [
    "intro",
    "why",
    "ingredients",
    "variations",
    "how-to-make",
    "serving",
    "tips",
    "faqs",
    "related",
  ];
  for (const key of expected) {
    t.check(structure.sections.has(key), `template exposes the "${key}" section`);
  }
  t.check(
    structure.unknownHeadings.length === 0,
    `every template heading classified (unknown: ${JSON.stringify(structure.unknownHeadings)})`,
  );

  /* ---------------------------------------------------------------- */

  const run = (name, markdown) => {
    let html = Markdown.toEditorHtml(markdown);
    const linked = LinkIndex.resolveLinks(html, links);
    html = linked.html;
    const aff = Affiliate.applyAffiliateLinks(html, affiliates);
    html = aff.html;

    const article = Mapper.readArticle(html);
    const relatedIds = [];
    const section = article.sections.get("related");
    if (section) {
      for (const el of section.body) {
        for (const m of el.html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
          const target = LinkIndex.resolveTarget(
            links,
            m[1],
            m[2].replace(/<[^>]+>/g, "").trim(),
          );
          if (target && !relatedIds.includes(target.wpId)) relatedIds.push(target.wpId);
        }
      }
    }

    // A fresh parse per export, so the mapper can never reach the original.
    const fresh = Template.readStructure(ORIGINAL);
    const { content, report } = Mapper.populateTemplate(fresh, article, {
      title: name,
      relatedIds: relatedIds.slice(0, 4),
    });

    return { content, report, article, linked, aff, relatedIds };
  };

  const cases = [
    ["Vegan Beet Hummus", BEET_HUMMUS],
    ["Za'atar Manakeesh", MANAKEESH],
    ["Summer Fruit Salad", FRUIT_SALAD],
  ].map(([name, md]) => [name, run(name, md)]);

  for (const [name, r] of cases) {
    t.section(`${name} — structure preserved`);

    const tree = Blocks.parseBlocks(r.content);
    const names = Blocks.flattenBlocks(tree).map((b) => b.name);

    t.check(
      Blocks.serializeBlocks(tree) === r.content,
      "populated output re-parses and re-serialises cleanly",
    );
    t.check(
      r.content.includes("wp:feast/advanced-jump-to-block"),
      "Feast jump-to block preserved",
    );
    t.check(
      r.content.includes("wp:wp-recipe-maker/recipe"),
      "WP Recipe Maker block preserved",
    );
    t.check(r.content.includes("feast/fsri-block"), "Feast related grid preserved");
    t.check(
      r.content.includes('class="wp-block-group feast-top-tip2"') &&
        r.content.includes('class="wp-block-group feast-top-tip"'),
      "feast-top-tip group classes preserved",
    );
    t.check(
      r.content.includes(
        "*See the recipe card at the bottom of the page for exact quantities",
      ),
      "the fixed recipe-card note is left exactly as written",
    );
    t.check(
      names.filter((n) => n === "columns").length > 0,
      "the two-column step grid is still columns",
    );
    t.check(
      /class="wp-block-image numpic turn2"/.test(r.content),
      "numpic step-image classes preserved (CSS numbering intact)",
    );
    t.check(
      names.filter((n) => n === "image").length >= 2,
      "template image placeholders kept in place",
    );
    t.check(
      !/<img[^>]+src=/i.test(r.content),
      "no image src was invented or uploaded",
    );

    t.section(`${name} — content mapped`);

    const steps = r.article.steps.length;
    t.check(steps > 0, `draft produced ${steps} steps`);
    t.check(
      r.report.stepsMapped === steps,
      `all ${steps} steps mapped into step columns (${r.report.stepsMapped})`,
    );
    for (const step of r.article.steps) {
      t.check(
        r.content.includes(step.heading),
        `step heading "${step.heading}" written into the template`,
      );
    }
    t.check(
      !/>Step (Five|Six|Seven|Eight)\s*</.test(r.content) || steps >= 5,
      "unused step labels removed rather than shipped empty",
    );
    t.check(
      r.report.faqsMapped === r.article.faqs.length && r.article.faqs.length > 0,
      `${r.article.faqs.length} FAQs written into the Yoast block`,
    );
    t.check(
      r.content.includes('class="schema-faq-question"'),
      "Yoast FAQ block markup rebuilt in the shape published posts use",
    );
    t.check(
      r.report.unmapped.length === 0,
      `no draft section left unmapped (${JSON.stringify(r.report.unmapped)})`,
    );

    // Nothing the author wrote may be dropped on the way in. Counted per
    // section, because a shell shortage used to lose a paragraph silently.
    for (const [key, section] of r.article.sections) {
      if (key === "recipe" || section.body.length === 0) continue;
      const row = r.report.sections.find((s) => s.key === key);
      if (!row || !row.inTemplate) continue;
      t.check(
        row.blocksWritten >= section.body.length,
        `${key}: all ${section.body.length} draft block(s) placed (${row?.blocksWritten})`,
      );
    }
    t.check(
      !r.report.needsReview,
      "the mapping needs no human review",
    );

    t.section(`${name} — the original template is untouched`);
    const reread = await prisma.wpPost.findUnique({
      where: { projectId_wpId: { projectId: PROJECT, wpId: TEMPLATE_ID } },
      select: { content: true },
    });
    t.check(reread.content === ORIGINAL, "template post content unchanged in the mirror");
    t.check(r.content !== ORIGINAL, "the populated copy is a different document");
  }

  /* ---------------------------------------------------------------- */
  t.section("Internal links");

  const hummus = cases[0][1];
  t.check(
    hummus.linked.resolved.length >= 8,
    `beet hummus resolved ${hummus.linked.resolved.length} internal links`,
  );
  t.check(
    hummus.linked.resolved.every((l) => l.url.startsWith("https://cinnamonsnail.com/")),
    "every resolved link points at a real cinnamonsnail.com URL",
  );
  t.check(
    !/\[[^\]]+\]\([^)]+\)/.test(hummus.content),
    "no raw Markdown link syntax survives into the post",
  );
  t.check(
    !/<p[^>]*>\s*https?:\/\//.test(hummus.content),
    "no bare URL is printed as visible text",
  );
  t.check(
    !/rel="[^"]*nofollow[^"]*"/.test(
      hummus.content.slice(0, hummus.content.indexOf("Ingredients")),
    ),
    "internal links are dofollow",
  );
  t.check(
    hummus.relatedIds.length === 4,
    `related grid resolved ${hummus.relatedIds.length} real post IDs`,
  );
  t.check(
    /wp:feast\/fsri-block \{[^}]*"id":"[0-9, ]+"/.test(hummus.content),
    "the Feast grid carries real WordPress post IDs",
  );

  const salad = cases[2][1];
  t.check(
    salad.linked.unresolved.some((u) => /imaginary/i.test(u.href)),
    "a link to a page that does not exist is reported as unresolved",
  );
  t.check(
    !salad.content.includes("/imaginary-pancakes/"),
    "the unverifiable link is dropped, not shipped broken",
  );
  t.check(
    salad.content.includes("My Imaginary Pancake Recipe"),
    "its anchor text is kept as plain words",
  );

  /* ---------------------------------------------------------------- */
  t.section("Affiliate links");

  const manakeesh = cases[1][1];
  const affLinked = manakeesh.aff.linked.map((l) => l.term);
  t.check(affLinked.length > 0, `manakeesh matched ${affLinked.length} sheet terms: ${affLinked.join(", ")}`);
  t.check(
    manakeesh.aff.linked.every((l) => {
      const row = affiliates.terms.find((x) => x.term === l.term);
      return row !== undefined && row.url === l.url;
    }),
    "every affiliate URL is the exact URL from the sheet, unaltered",
  );
  t.check(
    /rel="sponsored nofollow"/.test(manakeesh.content),
    "affiliate links carry rel=\"sponsored nofollow\"",
  );
  t.check(
    !/<a[^>]+href="https:\/\/(www\.)?amazon\.[a-z.]+\//i.test(manakeesh.content),
    "no plain Amazon product URL was substituted for an affiliate link",
  );

  const saladAff = salad.aff.linked;
  t.check(
    saladAff.length === 0,
    `fruit salad added no affiliate links (${saladAff.map((l) => l.term).join(", ") || "none"})`,
  );
  t.check(
    !/rel="sponsored/.test(salad.content),
    "no sponsored link appears in a draft with no sheet matches",
  );

  /* ---------------------------------------------------------------- */
  t.section("Images");

  const withImage = run(
    "Image Draft",
    `${FRUIT_SALAD}\n\n<p><img src="/api/articles/abc123/media/xyz" alt="a bowl"/></p>`,
  );
  t.check(
    withImage.report.localImagesSkipped >= 1,
    `${withImage.report.localImagesSkipped} app-hosted image(s) reported as skipped`,
  );
  t.check(
    !withImage.content.includes("/api/articles/"),
    "no app-hosted image URL reaches the WordPress payload",
  );

  /* ---------------------------------------------------------------- */
  t.section("Step count that does not match the template");

  const twelve = run(
    "Twelve Steps",
    BEET_HUMMUS.replace(
      "### Add the Beets",
      Array.from({ length: 9 }, (_, i) => `### Extra Step ${i + 1}\n\nDo the ${i + 1} thing.\n`).join("\n") +
        "\n### Add the Beets",
    ),
  );
  t.check(
    twelve.report.stepsMapped === twelve.article.steps.length,
    `${twelve.article.steps.length} steps all mapped (${twelve.report.stepColumnsAdded} columns cloned)`,
  );
  const turnClasses = [...twelve.content.matchAll(/class="wp-block-image numpic( turn[23]?)?"/g)]
    .map((m) => (m[1] ?? "").trim());
  t.check(
    turnClasses.length === twelve.article.steps.length,
    `one numbered step image per step (${turnClasses.length})`,
  );
  t.check(
    turnClasses.slice(0, 8).join("|") === "turn2|turn3|turn||turn2|turn3|turn|",
    `the four-class CSS rotation continues on cloned columns (${turnClasses.slice(0, 8).join("|")})`,
  );

  /* ---------------------------------------------------------------- */
  t.section("Related recipes that match nothing");

  const noMatches = run(
    "No Matches",
    FRUIT_SALAD.replace(
      "- [Vegan Zucchini Muffins With ORange Olive Oil Streusel](/vegan-zucchini-muffins-recipe/)",
      "- Something I have never written about\n- Another thing that does not exist",
    ),
  );
  t.check(
    noMatches.relatedIds.length === 0,
    "no post ID is invented for a recipe the site does not have",
  );
  t.check(
    !/wp:feast\/fsri-block \{[^}]*"id":"[0-9]/.test(noMatches.content),
    "the Feast grid is left as the template had it",
  );
  t.check(
    noMatches.content.includes("Something I have never written about"),
    "the author's list is kept as text rather than dropped",
  );
  t.check(
    !/<a[^>]*>Something I have never written about/.test(noMatches.content),
    "and it is kept as plain text, with no invented link",
  );

  /* ---------------------------------------------------------------- */
  t.section("The Drafter's own starting document");

  const PostTemplate = await built.load("lib/drafter/post-template.ts");
  const seedRaw = PostTemplate.buildPostTemplate({ title: "Vegan Beet Hummus" });
  const seed = PostTemplate.applyTemplateHeadings(
    seedRaw,
    [...structure.sections.values()]
      .filter((s) => s.heading !== null)
      .map((s) => ({ key: s.key, text: Blocks.blockText(s.heading) })),
  );

  const seedArticle = Mapper.readArticle(PostTemplate.stripPlaceholders(seed));
  for (const key of ["why", "ingredients", "variations", "how-to-make", "serving", "tips", "faqs", "related"]) {
    t.check(
      seedArticle.sections.has(key),
      `a new Drafter article's "${key}" heading maps to the template`,
    );
  }
  t.check(
    seedArticle.unmatched.filter((u) => u.words > 0).length === 0,
    `no seeded section is unmappable (${JSON.stringify(seedArticle.unmatched.map((u) => u.heading))})`,
  );
  t.check(
    seed.includes("Ingredients for Vegan Beet Hummus"),
    "a template heading that says less than the seeded one does not overwrite it",
  );

  /*
   * The editor drops HTML comments when it parses a document into ProseMirror's
   * schema, so the `<!-- snaily:todo -->` marker is gone after the first save.
   * While that was the only signal, prompts like "Hook - three or four
   * sentences" reached the live WordPress draft as copy.
   */
  const asEditorSaved = seed
    .replace(/<!-- snaily:todo -->/g, "")
    .replace(/<!-- \/?wp:[^>]*-->/g, "")
    .replace(/—/g, "-");

  const stripped = PostTemplate.stripPlaceholders(asEditorSaved);
  for (const prompt of [
    "Hook",
    "Lead photo goes here",
    "the story, why this version",
    "Advanced Jump To",
    "Vegan AF",
    "Reason two",
    "Ingredients photo",
    "Enter a question",
    "Enter the answer",
    "Pitfalls only",
    "Photo for step one",
  ]) {
    t.check(
      !stripped.includes(prompt),
      `the "${prompt}…" prompt never reaches WordPress, marker or not`,
    );
  }
  t.check(
    stripped.includes("Why you'll adore"),
    "section headings survive the strip",
  );
  t.check(
    stripped.includes("See the recipe card at the bottom"),
    "the template's real recipe-card note survives the strip",
  );
  t.check(
    PostTemplate.stripPlaceholders(
      "<p>Reason two, but the author actually wrote this bit.</p>",
    ).includes("the author actually wrote this bit"),
    "text an author has typed over a prompt is kept",
  );

  /* ---------------------------------------------------------------- */
  t.section("Draft-only safety");

  const Export = await built.load("lib/wordpress/blocks.ts"); // keep loader warm
  void Export;

  const guard = (fn) => {
    try {
      fn();
      return null;
    } catch (err) {
      return err.name;
    }
  };

  // Imported lazily: draft-export pulls in the WordPress client, which the
  // compiled test bundle does not need for anything else.
  const DraftExport = await import(
    new URL(
      "lib/wordpress/draft-export.js",
      new URL(`file:///${built.dir.replace(/\\/g, "/")}/`),
    ).href
  ).catch(() => null);

  if (DraftExport) {
    t.check(
      guard(() =>
        DraftExport.assertDraftOnly({
          status: "publish",
          targetPostId: null,
          templatePostId: TEMPLATE_ID,
        }),
      ) === "PublishRefused",
      "a publish status is refused",
    );
    t.check(
      guard(() =>
        DraftExport.assertDraftOnly({
          status: "draft",
          targetPostId: TEMPLATE_ID,
          templatePostId: TEMPLATE_ID,
        }),
      ) === "PublishRefused",
      "writing to the template post itself is refused",
    );
    t.check(
      guard(() =>
        DraftExport.assertDraftOnly({
          status: "draft",
          targetPostId: 39468,
          templatePostId: TEMPLATE_ID,
          targetStatus: "publish",
        }),
      ) === "PublishRefused",
      "overwriting a published post is refused",
    );
    t.check(
      guard(() =>
        DraftExport.assertDraftOnly({
          status: "draft",
          targetPostId: 12345,
          templatePostId: TEMPLATE_ID,
          targetStatus: "draft",
        }),
      ) === null,
      "updating an existing draft is allowed",
    );
  } else {
    t.check(false, "draft-export module compiled");
  }

  failures = t.report();
} finally {
  await prisma.$disconnect();
  built.cleanup();
}

process.exit(failures === 0 ? 0 : 1);
