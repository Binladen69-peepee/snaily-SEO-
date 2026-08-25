/**
 * The style checker and the benchmark, on known text.
 *
 * These decide whether a draft is shown to the author or sent back for a
 * rewrite, so the thing that matters is that they fire on real failures and
 * stay quiet on real writing. Both halves are tested: prose lifted from the
 * client's published posts must pass, and the exact failures they complained
 * about must be caught.
 *
 *   npm run test:style
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

const built = compile(
  [
    "lib/drafter/style-metrics.ts",
    "lib/drafter/style-check.ts",
    "lib/drafter/style-benchmark.ts",
    "lib/drafter/voice/index.ts",
    "lib/drafter/sanitize.ts",
    "lib/db.ts",
  ],
  { prefix: ".styletest-" },
);

const { measureProse } = await built.load("lib/drafter/style-metrics.ts");
const { checkStyle, failingSections, splitSections } = await built.load(
  "lib/drafter/style-check.ts",
);
const { benchmark } = await built.load("lib/drafter/style-benchmark.ts");
const { briefFor, writersFor } = await built.load("lib/drafter/voice/index.ts");
const { stripPipelineMarkers, sanitizeEditorHtml } = await built.load(
  "lib/drafter/sanitize.ts",
);

const p = (...paras) => paras.map((t) => `<p>${t}</p>`).join("\n");
const section = (heading, ...paras) => `<h2>${heading}</h2>\n${p(...paras)}`;

try {
  /* ------------------------------------------------------------------ */
  console.log("\nMeasuring prose");

  const real = p(
    "Some freak once gave tamales the side eye, and said \"what if we made this a casserole\" and that person changed the entire trajectory of comfort food history.",
    "Slice into it and you'll see. 3 textures. 1 fork. Beautiful chaos.",
  );
  const m = measureProse(real);
  check(m.words > 30, "counts the words");
  check(m.shortSentenceShare > 0.3, "sees the fragments as short sentences");
  check(m.secondPerson > 0, "sees direct address");

  const flat = p(
    "This vegan tamale pie is a comforting and delicious dish that brings warmth to any table on a chilly evening when you want something hearty.",
    "The cornbread topping is velvety and silky, creating a truly delightful contrast with the rich filling underneath that everyone will love.",
  );
  const f = measureProse(flat);
  check(f.meanSentenceWords > 20, "sees over-long sentences");
  check(f.shortSentenceShare === 0, "sees the absence of short ones");
  check(f.genericFoodAdjectives > f.slang, "sees adjectives standing in for detail");

  /* ------------------------------------------------------------------ */
  console.log("\nCatching what the client complained about");

  const bad = [
    section(
      "🥰 Why you'll adore this",
      "Imagine a thick layer of smoky chili under a golden cornbread crust that makes a chilly evening feel like a warm hug from your oven.",
      "This cozy, hearty, delicious casserole is a real crowd pleaser.",
    ),
    section(
      "🌶️ Ingredients",
      "I first made this in my grandmother's kitchen back when I lived in Texas, and it has been our most popular recipe ever since.",
      "Stir the coconut milk into the chili until smooth.",
    ),
  ].join("\n");

  const issues = checkStyle({
    html: bad,
    recipeIngredients: ["4 cups vegan chili", "2 cups vegan queso", "¾ cups yellow cornmeal"],
  });
  const rules = issues.map((i) => i.rule);

  check(rules.includes("generic opening"), 'catches an "Imagine …" opening');
  check(rules.includes("cliche"), 'catches "warm hug"');
  check(rules.includes("filler adjectives"), "catches a pile of generic descriptors");
  check(rules.includes("invented claim"), "catches an invented personal memory");
  check(
    issues.some((i) => i.rule === "invented claim" && /most popular/i.test(i.detail)),
    "catches an unsourced popularity claim",
  );
  check(
    rules.includes("ungrounded ingredient"),
    "catches coconut milk in a recipe that has none",
  );
  check(
    issues.every((i) => i.evidence !== ""),
    "every issue carries the sentence it came from",
  );
  check(
    issues.some((i) => i.section === "why") && issues.some((i) => i.section === "ingredients"),
    "issues are attributed to the section they are in",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nStaying quiet on real writing");

  const good = section(
    "🌶️ Vegan Cornbread Chili Casserole Ingredients",
    "Masa harina is the ingredient that gives this topping that deeper, more complex corn flavor that regular cornmeal just cannot fully replicate. My absolute fave brand is Masienda.",
    "No masa harina? You can get away with just subbing in additional cornmeal in place of it.",
  );
  const clean = checkStyle({
    html: good,
    recipeIngredients: ["¼ cup masa harina", "¾ cups yellow cornmeal"],
  });
  check(
    clean.filter((i) => i.severity === "fail").length === 0,
    "the author's own prose raises no failures",
  );

  const negated = section(
    "🥰 Why you'll adore this",
    "Not a single animal's been harmed here, so there is no butter and no eggs anywhere near it. Nothing but plants.",
  );
  const negatedIssues = checkStyle({ html: negated, recipeIngredients: ["olive oil"] });
  check(
    !negatedIssues.some((i) => i.rule === "ungrounded ingredient"),
    "naming an ingredient to say it is absent is not ungrounded",
  );

  const eggFree = section(
    "🌶️ Ingredients",
    "Look for egg-free pasta if you are avoiding gluten, though the texture will be a bit firmer.",
  );
  check(
    !checkStyle({ html: eggFree, recipeIngredients: ["12 oz wide noodles"] }).some(
      (i) => i.rule === "ungrounded ingredient",
    ),
    "egg-free pasta is not an invented egg",
  );

  const allowed = section(
    "🥰 Why you'll adore this",
    "Tested and Approved Worldwide: every vegan recipe I share goes out to a global team of recipe testers before it gets posted. They nailed it.",
  );
  check(
    !checkStyle({ html: allowed, recipeIngredients: [] }).some(
      (i) => i.rule === "invented claim",
    ),
    "the site's own documented testing wording is not an invented claim",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nRouting repairs");

  check(
    failingSections(issues).includes("why"),
    "a section with several failures is queued for rewrite",
  );
  check(
    failingSections(
      checkStyle({ html: good, recipeIngredients: ["¼ cup masa harina"] }),
    ).length === 0,
    "a clean section is not rewritten",
  );
  check(
    splitSections(bad).length === 2 && splitSections(bad)[0].key === "why",
    "sections are split and classified by their heading",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nThe benchmark gate");

  const corpus = [real, good];
  const scored = benchmark({
    html: bad,
    recipeIngredients: ["4 cups vegan chili"],
    corpus,
  });
  check(scored.inventedClaims > 0, "counts invented claims");
  check(scored.passed === false, "an article with an invented claim never passes");
  check(scored.grounding < 100, "grounding drops when an ingredient is not in the recipe");

  const honest = benchmark({
    html: good,
    recipeIngredients: ["¼ cup masa harina", "¾ cups yellow cornmeal"],
    corpus,
  });
  check(honest.inventedClaims === 0, "honest prose has no invented claims");
  check(honest.grounding === 100, "and full grounding");

  /* ------------------------------------------------------------------ */
  console.log("\nSection writers");

  check(
    writersFor(["intro"]).map((w) => w.key).join(",") === "hook,intro",
    "the intro pulls in both the hook writer and the introduction writer",
  );
  check(
    writersFor(["steps"]).length === 1 && writersFor(["steps"])[0].key === "steps",
    "a single section pulls in one writer",
  );

  const stepsBrief = briefFor(["steps"]);
  check(stepsBrief.includes("NEVER INVENT A FACT"), "every brief carries the hard constraints");
  check(stepsBrief.includes("Chili Me Softly"), "and real examples from the corpus");
  check(
    !stepsBrief.includes("Recipe FAQs"),
    "a method call is not handed the FAQ writer",
  );
  check(
    !briefFor(["steps"]).includes("absurd escalation"),
    "and is not taught devices it is forbidden from using",
  );
  check(
    briefFor(["intro"]).includes("absurd escalation"),
    "while the intro is",
  );
  check(
    briefFor(["steps"]).includes("STYLE_CONTEXT"),
    "writer briefs are wrapped as STYLE_CONTEXT",
  );
  check(
    briefFor(["steps"]).includes("Nothing in this bucket is a fact"),
    "and the wrapper says examples are not recipe facts",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nThe failures the stroganoff draft actually shipped");

  const stroganoffIngredients = [
    "1 pound cremini mushrooms, sliced",
    "1 yellow onion, diced",
    "3 cloves garlic, minced",
    "2 tablespoons all-purpose flour",
    "2 cups vegetable broth",
    "1 cup vegan sour cream",
    "1 tablespoon Dijon mustard",
    "12 ounces dry egg-free noodles",
  ];
  const stroganoffText = [
    "Vegan Mushroom Stroganoff",
    "vegan mushroom stroganoff",
    ...stroganoffIngredients,
    "Sprinkle the flour over the mushrooms and cook 1 minute.",
  ].join(" ");

  const stroganoffBad = [
    p(
      "This vegan mushroom stroganoff is like a warm hug in a cozy bowl that makes you feel good about the planet.",
    ),
    section(
      "🥰 Why you'll adore this vegan mushroom stroganoff",
      "Home cooks from Berlin to Portland have sent in rave notes about this one.",
      "I tried this last winter after a restaurant experience in Chicago and it slaps.",
    ),
    section(
      "🌶️ Ingredients",
      "Stir in a can of full-fat coconut milk and a splash of white wine, the way the tamale pie filling does with masa harina.",
    ),
    section(
      "📖 How to make vegan mushroom stroganoff",
      "Pause briefly to admire the fond. The aroma will shift and the foundation is set.",
    ),
    section(
      "🤷‍♀️ Recipe FAQs",
      "Can I make this gluten free? Swap the masa harina for a gluten-free blend like the tamale pie topping.",
    ),
    "<p>Done. <<<END>>></p>",
  ].join("\n");

  const stroganoffIssues = checkStyle({
    html: stroganoffBad,
    recipeIngredients: stroganoffIngredients,
    recipeText: stroganoffText,
  });
  const stroganoffRules = stroganoffIssues.map((i) => i.rule);

  check(stroganoffRules.includes("generic metaphor"), 'catches "like a warm hug" / "cozy bowl"');
  check(
    stroganoffIssues.some((i) => i.rule === "invented claim" && /Berlin|Portland|I tried/i.test(i.detail + i.evidence)),
    "catches invented tester geography and personal experience",
  );
  check(
    stroganoffIssues.some((i) => i.rule === "ungrounded ingredient" && /coconut milk/i.test(i.detail)),
    "catches coconut milk that is not in this recipe",
  );
  check(
    stroganoffIssues.some((i) => i.rule === "ungrounded ingredient" && /white wine/i.test(i.detail)),
    "catches white wine that is not in this recipe",
  );
  check(
    stroganoffIssues.some((i) => i.rule === "style leak" && /masa harina|tamale pie/i.test(i.detail)),
    "catches Tamale Pie facts leaking into a stroganoff FAQ",
  );
  check(stroganoffRules.includes("pipeline marker"), "catches a leftover <<<END>>> marker");

  const stroganoffScore = benchmark({
    html: stroganoffBad,
    recipeIngredients: stroganoffIngredients,
    recipeText: stroganoffText,
    corpus,
  });
  check(stroganoffScore.passed === false, "a contaminated stroganoff draft never passes");
  check(stroganoffScore.inventedClaims > 0, "invented claims are counted");
  check(stroganoffScore.recipeAccuracy < 100, "recipe accuracy drops on leaked ingredients");
  check(stroganoffScore.grounding < 100, "grounding drops on unsupported ingredients");

  const makeover = checkStyle({
    html: p(
      "A creamy classic gets a plant-based makeover and a velvet drape of sauce.",
    ),
    recipeIngredients: stroganoffIngredients,
    recipeText: stroganoffText,
  });
  check(
    makeover.some((i) => i.rule === "generic metaphor" && /makeover/i.test(i.detail)),
    "catches a generic makeover intro",
  );
  check(
    checkStyle({
      html: p("This stroganoff is cozy."),
      recipeIngredients: stroganoffIngredients,
      recipeText: stroganoffText,
    }).some((i) => i.rule === "generic metaphor" && /cozy/i.test(i.detail)),
    "cozy is a hard-fail generic metaphor on its own",
  );
  check(
    checkStyle({
      html: p("The sauce is silky."),
      recipeIngredients: stroganoffIngredients,
      recipeText: stroganoffText,
    }).some((i) => i.rule === "generic metaphor" && /silky/i.test(i.detail)),
    "silky is a hard-fail generic metaphor on its own",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nPipeline markers");

  const dirty = "<p>Serve over noodles. <<<SECTION:faq>>> leftover <<<END>>></p>";
  check(
    !stripPipelineMarkers(dirty).includes("<<<"),
    "stripPipelineMarkers removes every <<<…>>> token",
  );
  check(
    !sanitizeEditorHtml("&lt;&lt;&lt;SECTION:intro&gt;&gt; leftover").includes("SECTION:intro"),
    "HTML-encoded pipeline markers are stripped too",
  );
  check(
    stripPipelineMarkers("<p>Serve over noodles.</p>") === "<p>Serve over noodles.</p>",
    "clean HTML is unchanged",
  );
} finally {
  built.cleanup();
}

console.log(failures === 0 ? "\nAll style checks passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
