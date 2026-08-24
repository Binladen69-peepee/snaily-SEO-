/**
 * The stages that produce the article: validate, research, outline, write.
 *
 * Every model call here is bounded twice over — by the token ceiling in
 * `ctx.ai`, and by only ever being asked for two or three sections at a time.
 * That is the whole answer to the 800-word draft: the previous pipeline asked
 * for a finished post in one request, and a request that must contain the style
 * guide, the playbook, six sample posts and the recipe has roughly 3,000 tokens
 * left to write with. Five requests of three sections each have that much for
 * every one of them.
 */

import { parseBrief, prepareArticle } from "@/lib/articles";
import { recentPostLength } from "@/lib/drafter/corpus";
import { clip } from "@/lib/ai-policy";
import { selectSpecialtyIngredients } from "@/lib/drafter/specialty";
import { briefFor, bodyBriefFor } from "@/lib/drafter/voice";
import { buildLinkIndex } from "@/lib/content/link-index";
import {
  factBuckets,
  styleContext,
} from "@/lib/drafter/context-buckets";
import {
  formatIngredients,
  formatSteps,
  parseRecipePaste,
  validateRecipePaste,
} from "@/lib/drafter/recipe-paste";
import { parseRecipe, type RecipeCard } from "@/lib/drafter/recipe";
import { rulesFor } from "@/lib/drafter/section-rules";
import { buildStyleBrief } from "@/lib/drafter/style-brief";
import { STYLE_GUIDE } from "@/lib/drafter/style";
import { prisma } from "@/lib/db";
import { StageFailure, type StageContext, type StageResult } from "@/lib/jobs/context";
import {
  REQUIRED_SECTIONS,
  WORD_SHARE,
  defaultHeading,
  parseOutlineLines,
  parseSections,
  stripDelimiters,
  planGroups,
  trimToOneHeading,
  type SectionGroup,
} from "@/lib/jobs/plan";
import {
  SECTION_KEYS,
  type JobResearch,
  type OutlineSection,
  type Provenance,
  type SectionKey,
} from "@/lib/jobs/types";

/** A post this long is what the site publishes; a 900-word one is unfinished. */
const DEFAULT_TARGET_WORDS = 1_800;
const MIN_TARGET_WORDS = 1_200;
const MAX_TARGET_WORDS = 2_800;

/* -------------------------------------------------------------------------
 * 1. Validate
 * ---------------------------------------------------------------------- */

export async function validate(ctx: StageContext): Promise<StageResult> {
  const { article, state } = ctx;

  if (article.keyword.trim() === "") {
    throw new StageFailure("no_keyword", "This article has no target keyword.");
  }
  if (article.title.trim() === "") {
    throw new StageFailure("no_title", "This article has no working title.");
  }

  const parsed = parseRecipePaste(article.recipe);
  const issues = validateRecipePaste(parsed);
  if (issues.length > 0) {
    throw new StageFailure("recipe_unusable", issues.map((i) => i.message).join(" "));
  }

  state.parsed = parsed;
  state.titleAtStart = article.title;

  /*
   * The voice brief is built here rather than inside the first writing call so
   * that "WordPress has never been synced" is reported as a validation result
   * the author can act on, instead of quietly producing a post in nobody's
   * voice five stages later.
   */
  state.styleBrief = await buildStyleBrief(article.projectId);

  ctx.log("validated", {
    ingredients: parsed.ingredients.length,
    steps: parsed.steps.length,
    styleBriefChars: state.styleBrief.length,
  });

  return {
    kind: "done",
    output: {
      ingredients: parsed.ingredients.length,
      steps: parsed.steps.length,
      styleCorpus: state.styleBrief.startsWith("VOICE REFERENCE: unavailable")
        ? "unavailable"
        : "real",
    },
  };
}

/* -------------------------------------------------------------------------
 * 2. Research
 * ---------------------------------------------------------------------- */

export async function research(ctx: StageContext): Promise<StageResult> {
  const { article, state } = ctx;
  const provenance: Provenance[] = [];

  const existing = await prisma.article.findUnique({
    where: { id: article.id },
    select: { brief: true, briefError: true },
  });

  let brief = parseBrief(existing?.brief);
  if (brief === null) {
    await prepareArticle(article.id, article.keyword, article.country);
    const refreshed = await prisma.article.findUnique({
      where: { id: article.id },
      select: { brief: true, briefError: true },
    });
    brief = parseBrief(refreshed?.brief);
    if (brief === null) {
      provenance.push({
        label: "SERP",
        source: "SerpApi",
        status: "unavailable",
        detail: refreshed?.briefError ?? "No SERP data could be collected.",
      });
    }
  }

  if (brief !== null) {
    provenance.push({
      label: "SERP",
      source: "SerpApi",
      status: "real",
      detail: `${String(brief.serp.length)} ranking pages analysed on ${brief.builtAt.slice(0, 10)}`,
    });
  }

  /*
   * Search Console is used when this project is connected to a property, and
   * reported as unavailable when it is not. It is never approximated from SERP
   * data — a query the site does not actually rank for is not a Search Console
   * fact, and labelling it as one is the kind of thing that ends up in a client
   * report.
   */
  const project = await prisma.project.findUnique({
    where: { id: article.projectId },
    select: { gscSiteUrl: true },
  });

  const gscQueries =
    project?.gscSiteUrl == null
      ? []
      : await prisma.gscQueryMetric.findMany({
          where: {
            projectId: article.projectId,
            query: { contains: article.keyword.split(" ")[0] ?? "", mode: "insensitive" },
          },
          orderBy: { impressions: "desc" },
          take: 10,
          select: { query: true },
        });

  provenance.push(
    project?.gscSiteUrl == null
      ? {
          label: "Search Console",
          source: "Google Search Console",
          status: "unavailable",
          detail: "No Search Console property is linked to this project.",
        }
      : {
          label: "Search Console",
          source: "Google Search Console",
          status: "real",
          detail: `${String(gscQueries.length)} related queries from ${project.gscSiteUrl}`,
        },
  );

  const index = await buildLinkIndex(article.projectId);
  provenance.push(
    index.all.length === 0
      ? {
          label: "Internal links",
          source: "WordPress published posts",
          status: "unavailable",
          detail: "No published posts have been synced from WordPress.",
        }
      : {
          label: "Internal links",
          source: "WordPress published posts",
          status: "real",
          detail: `${String(index.all.length)} published URLs available to link`,
        },
  );

  /*
   * How long this post should be, from two real measurements rather than a
   * number somebody liked: what the ranking pages run to, and what this author
   * actually publishes. The larger wins, because falling short of the house
   * length is the failure that gets noticed and overshooting the SERP is not.
   */
  const serpTarget = brief?.targetWords ?? 0;
  const houseTarget = await recentPostLength(article.projectId);
  const measured = Math.max(serpTarget, Math.round(houseTarget * 0.9));

  const targetWords = Math.min(
    MAX_TARGET_WORDS,
    Math.max(MIN_TARGET_WORDS, measured > 0 ? measured : DEFAULT_TARGET_WORDS),
  );

  const questions = [
    ...(brief?.questions ?? []),
    ...gscQueries.map((q) => q.query).filter((q) => q.includes("?")),
  ];

  const payload: JobResearch = {
    keyword: article.keyword,
    targetWords,
    terms: (brief?.terms ?? []).slice(0, 20).map((t) => t.term),
    headings: (brief?.headings ?? []).slice(0, 12).map((h) => h.text),
    questions: [...new Set(questions)].slice(0, 12),
    serpPages: brief?.serp.length ?? 0,
    internalPosts: index.all
      .filter((t) => t.type === "post")
      .slice(0, 60)
      .map((t) => ({ title: t.title, url: t.url })),
    provenance,
  };

  state.research = payload;
  state.words = { target: targetWords, actual: 0 };

  ctx.log("researched", {
    serpPages: payload.serpPages,
    questions: payload.questions.length,
    internalPosts: payload.internalPosts.length,
    serpTarget,
    houseTarget,
    targetWords,
  });

  return {
    kind: "done",
    output: {
      serpPages: payload.serpPages,
      questions: payload.questions.length,
      internalPosts: payload.internalPosts.length,
      provenance: provenance.map((p) => `${p.label}: ${p.status}`),
    },
  };
}

/* -------------------------------------------------------------------------
 * 3. Outline
 * ---------------------------------------------------------------------- */

export async function outline(ctx: StageContext): Promise<StageResult> {
  const { article, state } = ctx;
  const parsed = state.parsed;
  const research = state.research;
  if (parsed === undefined || research === undefined) {
    throw new StageFailure("missing_input", "Outline ran before validation finished.");
  }

  const system = [
    "You are Adam of The Cinnamon Snail, planning a vegan recipe blog post.",
    styleContext([
      state.styleBrief,
      "The section order is fixed by the site's format. Your job is to choose",
      "which optional sections this recipe earns, and to write each heading in",
      "the house style with the right emoji.",
    ]),
  ].join("\n\n");

  const user = [
    factBuckets({
      title: article.title,
      keyword: article.keyword,
      ingredients: clip(formatIngredients(parsed), 1_200),
      steps: clip(formatSteps(parsed), 1_400),
      questions: research.questions.slice(0, 8),
      posts: research.internalPosts,
    }),
    "",
    "Plan the post. Output one line per section, nothing else, in this exact format:",
    "key | H2 heading exactly as it should appear | one line on what the section covers",
    "",
    `Allowed keys, in this order: ${SECTION_KEYS.join(", ")}.`,
    "Always include: intro, why, ingredients, steps, serving, tips, faq.",
    "Include `variations` only if real versions or sibling dishes exist.",
    "Include `related` if the site has sibling recipes to close with.",
    "The `intro` line's heading column must be empty (the intro carries no heading).",
    "",
    "Heading rules: almost every H2 opens with an emoji.",
    "🥰 Why you'll adore … / 📖 How to make … / 💡Serving Ideas / 👉Top tips /",
    "🤷‍♀️ Recipe FAQs / 🤯 Variations / ✌️You'll also love … .",
    "The ingredients H2 takes a dish-specific emoji, not a fixed one.",
    "At most half the H2s may contain the primary keyword.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const raw = await ctx.ai({ system, user, maxTokens: 700, temperature: 0.5 });
  const lines = parseOutlineLines(raw);

  /*
   * The model chose the wording; the structure is not up for negotiation. A
   * missing required section is added back with a default heading rather than
   * letting a malformed reply quietly produce a post with no FAQ.
   */
  const chosen = new Map(lines.map((l) => [l.key, l]));
  for (const key of REQUIRED_SECTIONS) {
    if (!chosen.has(key)) {
      chosen.set(key, { key, heading: defaultHeading(key, article.title), brief: "" });
    }
  }

  const ordered = SECTION_KEYS.filter((k) => chosen.has(k));
  const totalShare = ordered.reduce((sum, k) => sum + WORD_SHARE[k], 0);

  const sections: OutlineSection[] = ordered.map((key) => {
    const line = chosen.get(key)!;
    return {
      key,
      heading: key === "intro" ? "" : line.heading || defaultHeading(key, article.title),
      brief: line.brief,
      targetWords: Math.round((research.targetWords * WORD_SHARE[key]) / totalShare),
    };
  });

  state.outline = {
    title: article.title,
    sections,
    targetWords: research.targetWords,
  };

  ctx.log("outlined", {
    sections: sections.length,
    keys: sections.map((s) => s.key).join(","),
  });

  return {
    kind: "done",
    output: { sections: sections.map((s) => `${s.key}: ${s.heading}`) },
  };
}

/* -------------------------------------------------------------------------
 * 4. Sections
 * ---------------------------------------------------------------------- */

/**
 * No links, ever, at writing time.
 *
 * A model asked for a URL invents one, and a model asked for a relative slug
 * invents that instead — then the prose is built around a target that has to be
 * removed again. Naming the recipe in plain words costs nothing and the link
 * stages turn the real ones into anchors afterwards.
 */
/**
 * The rhythm targets, measured rather than chosen.
 *
 * Taken from the client's seven most recent published posts against a draft of
 * the same recipe. The draft averaged 22.4-word sentences to their 15.7, ran
 * 2.7x their share of sentences over 28 words, and used 7.5x the generic food
 * adjectives. Those three numbers are most of what "it still sounds like AI"
 * turned out to mean, so they are stated as numbers rather than as adjectives.
 */
const RHYTHM = `
SENTENCE RHYTHM - measured from this author's published posts, and the single
biggest difference between their writing and a machine's:
- Sentences average 15-16 words. Not 22.
- About one sentence in four is under 8 words. Write them. A fragment with no
  verb is correct and common here.
- About one in nine runs past 28 words, and never two in a row.
- Vary hard inside a paragraph: a long one, then a short one. Never three
  sentences of the same length together.
- Paragraphs run 1-3 sentences. Half of them are a single sentence.
- Ask the reader something occasionally. Use an exclamation mark rarely.
- Put an aside in brackets roughly once every 150 words.
- Say "you" often and "I" freely - this is a person writing, not a brand.

Adjectives are the tell. This author names things instead: masa harina, Trader
Joe's, an offset spatula, 47 corn husk parcels. A sentence that leans on
"cozy", "delicious", "silky", "velvety", "hearty" or "comforting" is a sentence
with nothing in it.
`.trim();

const NO_LINKS_RULE = [
  "Never write a link, a URL, or Markdown link syntax. Name other recipes in",
  "plain words only — links are added later from the site's real post list.",
  "Never write an image, a photo caption, or Markdown image syntax.",
].join("\n");

/** STYLE_CONTEXT for a writing call: house rules, then the writers for these keys. */
function styleSystem(styleBrief: string | undefined, keys: SectionKey[]): string {
  return [
    styleContext([STYLE_GUIDE, RHYTHM, styleBrief]),
    bodyBriefFor(keys),
    NO_LINKS_RULE,
  ]
    .filter((b) => b !== "")
    .join("\n\n");
}

function factsFor(
  ctx: StageContext,
  extra?: {
    ingredientsClip?: number;
    stepsClip?: number;
    posts?: boolean;
    research?: boolean;
  },
): string {
  const parsed = ctx.state.parsed;
  const research = ctx.state.research;
  if (parsed === undefined) return "";
  const includeResearch = extra?.research !== false;
  return factBuckets({
    title: ctx.article.title,
    keyword: ctx.article.keyword,
    ingredients: clip(formatIngredients(parsed), extra?.ingredientsClip ?? 1_400),
    steps: clip(formatSteps(parsed), extra?.stepsClip ?? 800),
    terms: includeResearch ? research?.terms : undefined,
    questions: includeResearch ? research?.questions : undefined,
    headings: includeResearch ? research?.headings : undefined,
    posts: extra?.posts === false ? [] : research?.internalPosts.slice(0, 24),
  });
}

export async function sections(ctx: StageContext): Promise<StageResult> {
  const { state } = ctx;
  const parsed = state.parsed;
  const plan = state.outline;
  const research = state.research;
  if (parsed === undefined || plan === undefined || research === undefined) {
    throw new StageFailure("missing_input", "Writing ran before the outline was ready.");
  }

  const groups = planGroups(
    plan.sections.map((s) => s.key).filter((k) => k !== "faq"),
    parsed.steps.length,
  );

  state.sections ??= {};
  state.groupsDone ??= [];

  for (const group of groups) {
    if (state.groupsDone.includes(group.id)) continue;

    /*
     * Yield rather than start a call that cannot finish. A half-written
     * section is worse than none: the chunk that got cut off is what the
     * completeness check later reports as a thin section, and nobody can tell
     * it apart from a model that simply stopped early.
     */
    if (ctx.outOfTime()) {
      return {
        kind: "partial",
        note: `${String(state.groupsDone.length)}/${String(groups.length)}`,
      };
    }

    const written = await writeGroup(ctx, group, parsed.steps);
    for (const [key, body] of Object.entries(written) as [SectionKey, string][]) {
      const existing = state.sections[key] ?? "";
      // Split methods append; everything else is written exactly once.
      state.sections[key] =
        existing === "" ? body : `${existing}\n\n${stripHeading(body)}`;
    }

    state.groupsDone.push(group.id);
    ctx.log("section_group", {
      group: group.id,
      keys: Object.keys(written).join(","),
    });
  }

  return {
    kind: "done",
    output: { groups: state.groupsDone, sections: Object.keys(state.sections) },
  };
}

/** Second half of a split method must not restate the "How to make" H2. */
function stripHeading(body: string): string {
  return body.replace(/^\s*##\s+.*\n+/, "").trim();
}

async function writeGroup(
  ctx: StageContext,
  group: SectionGroup,
  steps: string[],
): Promise<Partial<Record<SectionKey, string>>> {
  const { state } = ctx;
  const plan = state.outline!;
  const parsed = state.parsed!;

  const targets = group.keys
    .map((k) => plan.sections.find((s) => s.key === k))
    .filter((s): s is OutlineSection => s !== undefined);

  const system = [
    `You are Adam of The Cinnamon Snail, writing part of a vegan recipe post.`,
    styleSystem(state.styleBrief, group.keys),
  ].join("\n\n");

  const stepSlice =
    group.steps === undefined
      ? ""
      : steps
          .slice(group.steps.from - 1, group.steps.to)
          .map((s, i) => `${String(group.steps!.from + i)}. ${s}`)
          .join("\n");

  /*
   * Which recipes this call may name.
   *
   * It used to be given only to the three sections that obviously list sibling
   * dishes, which is exactly why every internal link in a finished post landed
   * in those three. A section with nothing to name cannot be linked by the
   * pass that runs afterwards, so the intro, the "why" bullets, the specialty
   * ingredients and the FAQ were structurally incapable of carrying a link.
   */
  const namesSiblings = group.keys.some((k) =>
    ["intro", "why", "ingredients", "variations", "serving", "related", "faq"].includes(k),
  );

  /*
   * The specialty section is told what to cover.
   *
   * Every call gets the full ingredient list as the source of truth for the
   * method, and under that instruction the specialty section dutifully wrote a
   * sub-block for all fifteen lines of a soup - celery included. The choosing
   * is a filtering problem, not a writing one, so it is done before the call.
   */
  const specialty = group.keys.includes("ingredients")
    ? selectSpecialtyIngredients(parsed.ingredients)
    : [];

  const user = [
    factsFor(ctx, {
      posts: namesSiblings,
      research: group.keys.includes("intro") || group.keys.includes("faq"),
      stepsClip: group.keys.includes("steps") ? 1_400 : 400,
      ingredientsClip:
        group.keys.includes("ingredients") || group.keys.includes("steps") ? 1_400 : 700,
    }),
    "",
    "Write the following sections of the post. Nothing else.",
    "",
    "Sections to write now:",
    ...targets.map(
      (t) =>
        `- ${t.key}: heading "${t.heading || "(no heading)"}", about ${String(t.targetWords)} words.${t.brief === "" ? "" : ` Covers: ${t.brief}`}`,
    ),
    group.steps === undefined
      ? ""
      : `Write ONLY steps ${String(group.steps.from)} to ${String(group.steps.to)}${group.steps.from > 1 ? " — do not repeat the H2, and do not re-introduce the section" : ""}.`,
    group.steps === undefined ? "" : `Method steps to describe:\n${stepSlice}`,
    specialty.length > 0
      ? [
          "Write a sub-block for exactly these ingredients, in this order, and no others:",
          ...specialty.map((s) => `- ${s.name} (recipe line: ${s.line})`),
        ].join("\n")
      : "",
    "",
    "Write ONLY the sections listed above. Do not add a heading of your own,",
    "and do not write a section that was not asked for - another call is writing",
    "the rest of the post.",
    "",
    "Facts come only from RECIPE_CONTEXT, RESEARCH_CONTEXT and SITE_CONTEXT.",
    "STYLE_CONTEXT is rhythm and jokes. Never copy an ingredient or method from it.",
    "",
    "Output format — use these exact delimiters and no other commentary:",
    ...targets.map((t) => `<<<SECTION:${t.key}>>>\n(markdown for ${t.key})`),
    "<<<END>>>",
    "",
    "Markdown only. ## for the section heading, ### for step headings. No H1.",
    "No code fence. No preamble.",
    "Wrap each section with the <<<SECTION:key>>> / <<<END>>> markers listed above.",
    "Those markers are stripped after parsing. Never write them inside a sentence.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const raw = await ctx.ai({
    system,
    user,
    maxTokens: group.maxTokens,
    temperature: 0.75,
  });

  const written = parseSections(raw);

  /*
   * A reply with no delimiters at all is still usable when the group is a
   * single section — the model simply wrote the prose. Two or more sections
   * without delimiters cannot be split safely, and guessing at the boundary
   * would silently file half the ingredients section under variations.
   */
  if (Object.keys(written).length === 0) {
    if (group.keys.length === 1) {
      const only = group.keys[0]!;
      return {
        [only]: stripDelimiters(trimToOneHeading(raw.trim(), only !== "intro")),
      };
    }
    throw new StageFailure(
      "unparsable_sections",
      "The model returned the sections without their delimiters.",
      true,
    );
  }

  const trimmed: Partial<Record<SectionKey, string>> = {};
  for (const [key, body] of Object.entries(written) as [SectionKey, string][]) {
    // Steps arriving as a second half must not be read as a stray heading; the
    // caller strips their repeated H2 before appending.
    const allowHeading = key !== "intro";
    const kept = stripDelimiters(trimToOneHeading(body, allowHeading));
    if (kept !== "") trimmed[key] = kept;
  }

  return trimmed;
}

/* -------------------------------------------------------------------------
 * 5. Recipe content
 * ---------------------------------------------------------------------- */

/**
 * The recipe card, built from the paste and nothing else.
 *
 * No model call, on purpose. Quantities, times and temperatures are the part of
 * a recipe post where being approximately right is the same as being wrong, and
 * a model asked to tidy a list will round 18 minutes to 20 or add the salt it
 * expected to see. Every field here is the author's own words, split into
 * fields; anything the paste does not say stays empty for them to fill in.
 *
 * Fields they have already filled in are never touched. Somebody who typed
 * their yield and cook time into the recipe panel has said something the paste
 * does not, and a generation run is not a reason to lose it.
 */
export async function recipe(ctx: StageContext): Promise<StageResult> {
  const parsed = ctx.state.parsed;
  if (parsed === undefined) {
    throw new StageFailure("missing_input", "The recipe stage ran before validation.");
  }

  const row = await prisma.article.findUnique({
    where: { id: ctx.article.id },
    select: { recipeCard: true, title: true },
  });
  const card = parseRecipe(row?.recipeCard);

  /*
   * The card's opening sentence.
   *
   * The only prose on the recipe card, and the last voice a reader sees before
   * the post turns into quantities - so it gets its own writer rather than
   * being left blank or filled with the meta description. Written only when
   * the author has not written one: their sentence always wins.
   */
  let description = card.description.trim();
  if (description === "" && !ctx.outOfTime()) {
    const written = await ctx.ai({
      system: [
        "You are Adam of The Cinnamon Snail.",
        styleContext([ctx.state.styleBrief]),
        briefFor(["recipe-card"]),
      ].join("\n\n"),
      user: [
        factsFor(ctx, { ingredientsClip: 700, stepsClip: 400, posts: false }),
        "",
        `Recipe card name: ${card.name || (row?.title ?? ctx.article.title)}`,
        "",
        "Write the recipe card's opening sentence. One or two sentences, nothing else.",
        "Only facts from RECIPE_CONTEXT.",
      ].join("\n"),
      maxTokens: 160,
      temperature: 0.8,
    });
    description = written
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .split(/\n/)[0]!
      .trim()
      .slice(0, 320);
  }

  const filled: RecipeCard = {
    ...card,
    name: card.name || (row?.title ?? ctx.article.title),
    description,
    ingredients: card.ingredients.length > 0 ? card.ingredients : parsed.ingredients,
    steps:
      card.steps.length > 0
        ? card.steps
        : parsed.steps.map((text) => ({ text, name: "" })),
  };

  await prisma.article.update({
    where: { id: ctx.article.id },
    data: { recipeCard: filled },
  });

  ctx.log("recipe_card", {
    ingredients: filled.ingredients.length,
    steps: filled.steps.length,
    summaryWritten: card.description.trim() === "" && description !== "",
    sectioned: parsed.sectioned,
    keptAuthorCard: card.ingredients.length > 0 || card.steps.length > 0,
  });

  return {
    kind: "done",
    output: {
      ingredients: filled.ingredients.length,
      steps: filled.steps.length,
      source: "author paste",
    },
  };
}

/* -------------------------------------------------------------------------
 * 6. FAQ
 * ---------------------------------------------------------------------- */

export async function faq(ctx: StageContext): Promise<StageResult> {
  const { state } = ctx;
  const parsed = state.parsed;
  const research = state.research;
  if (parsed === undefined || research === undefined) {
    throw new StageFailure("missing_input", "The FAQ stage ran before research.");
  }

  const system = [
    "You are Adam of The Cinnamon Snail, writing the FAQ for a vegan recipe post.",
    styleContext([state.styleBrief, SECTION_FAQ_RULE]),
    briefFor(["faq"]),
  ].join("\n\n");

  const user = [
    factsFor(ctx, { ingredientsClip: 1_000, stepsClip: 1_200 }),
    "",
    "Write 3 to 5 FAQs for this recipe.",
    "",
    "Output one block per question, in exactly this format and nothing else:",
    "Q: the question",
    "A: the answer",
    "",
    "Answer only from RECIPE_CONTEXT. RESEARCH_CONTEXT questions are suggestions,",
    "not facts. Never import an ingredient, method or timing from STYLE_CONTEXT.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const raw = await ctx.ai({ system, user, maxTokens: 800, temperature: 0.6 });

  const entries: { question: string; answer: string }[] = [];
  const blocks = raw.split(/\n(?=Q:)/i);
  for (const block of blocks) {
    const q = /Q:\s*(.+)/i.exec(block);
    const a = /A:\s*([\s\S]+)/i.exec(block);
    if (q === null || a === null) continue;
    const question = asQuestion(stripDelimiters(q[1]!).replace(/\*\*/g, ""));
    const answer = stripDelimiters(a[1]!).replace(/\n{2,}/g, " ");
    if (question !== "" && answer !== "") entries.push({ question, answer });
  }

  if (entries.length === 0) {
    throw new StageFailure("faq_unparsable", "The FAQ came back in an unusable shape.", true);
  }

  state.faq = entries.slice(0, 5);
  ctx.log("faq_written", { questions: state.faq.length });

  return { kind: "done", output: { questions: state.faq.length } };
}

/**
 * Normalises an FAQ question, and gives it exactly one question mark.
 *
 * The research pass used to append "?" to anything it collected, so a Top tips
 * directive reached this stage as "Do not let the soup boil.?" and the model
 * politely wrote an answer to it. That is fixed at the source in `lib/text.ts`;
 * this is the second lock, because the researched questions are only ever
 * suggestions and a model can still hand back a statement.
 */
function asQuestion(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim().replace(/[.?!\s]+$/, "");
  return trimmed === "" ? "" : `${trimmed}?`;
}

const SECTION_FAQ_RULE = [
  "Answer only from the pasted recipe and general vegan cooking knowledge.",
  "Never state a time, temperature or quantity the recipe does not give.",
  "Never make a health or nutrition claim.",
  "Conversational, 1-3 sentences per answer. No links, no images.",
  "Every question must read as a question a reader would actually type.",
  "Never turn a cooking instruction into a question.",
  "Answers are one paragraph of plain prose - no line breaks, no lists.",
].join("\n");

/* -------------------------------------------------------------------------
 * 7. Expand
 * ---------------------------------------------------------------------- */

/** Below this share of the target, the post reads as unfinished. */
const SHORT_THRESHOLD = 0.8;

/**
 * Tops up the thinnest sections, and only those.
 *
 * The instinct when a draft comes out short is to generate it again, longer.
 * That throws away work the author may already be reading, costs a full
 * article's tokens, and produces a different post rather than a fuller one. So
 * this finds the two sections furthest below their own target and rewrites
 * exactly those.
 */
export async function expand(ctx: StageContext): Promise<StageResult> {
  const { state } = ctx;
  const plan = state.outline;
  const written = state.sections;
  if (plan === undefined || written === undefined) {
    return { kind: "skipped", reason: "Nothing written to expand." };
  }

  const wordsOf = (md: string) => md.split(/\s+/).filter(Boolean).length;
  const actual = Object.values(written).reduce(
    (sum, md) => sum + wordsOf(md ?? ""),
    0,
  );
  const faqWords = (state.faq ?? []).reduce(
    (sum, f) => sum + wordsOf(f.question) + wordsOf(f.answer),
    0,
  );
  const total = actual + faqWords;

  state.words = { target: plan.targetWords, actual: total };

  if (state.expanded === true) {
    return { kind: "skipped", reason: "Already expanded once." };
  }
  if (total >= plan.targetWords * SHORT_THRESHOLD) {
    return {
      kind: "skipped",
      reason: `${String(total)} words against a ${String(plan.targetWords)} target — long enough.`,
    };
  }

  const thin = plan.sections
    .filter((s) => s.key !== "faq" && s.key !== "steps" && (written[s.key] ?? "") !== "")
    .map((s) => ({ section: s, deficit: s.targetWords - wordsOf(written[s.key] ?? "") }))
    .filter((s) => s.deficit > 40)
    .sort((a, b) => b.deficit - a.deficit)
    .slice(0, 2);

  if (thin.length === 0) {
    return { kind: "skipped", reason: "No single section is short enough to blame." };
  }

  for (const { section } of thin) {
    if (ctx.outOfTime()) return { kind: "partial", note: "expanding" };

    const system = [
      "You are Adam of The Cinnamon Snail, deepening one section of your own draft.",
      styleContext([state.styleBrief]),
      rulesFor([section.key]),
      NO_LINKS_RULE,
      "Keep every fact, every step and every measurement exactly as written.",
      "Do not change the heading. Do not add a new section.",
      "Do not pad a short instruction with aroma, admiration, or filler metaphors.",
    ].join("\n\n");

    const user = [
      factsFor(ctx, { research: false, stepsClip: 400 }),
      "",
      `This section is ${String(wordsOf(written[section.key] ?? ""))} words and should be about ${String(section.targetWords)}.`,
      "Rewrite it fuller: more specifics, more of the story, the same voice.",
      "Adding a paragraph of substance is right; padding a sentence with adjectives is not.",
      "Facts only from RECIPE_CONTEXT / RESEARCH_CONTEXT / SITE_CONTEXT.",
      "",
      "Return the section in Markdown, nothing else. No <<< delimiters.",
      "",
      clip(written[section.key] ?? "", 3_000),
    ].join("\n");

    const raw = await ctx.ai({ system, user, maxTokens: 900, temperature: 0.7 });
    /*
     * Stripped, not trusted. This prompt quotes the section rules back to the
     * model, and the rules are written in the delimiter format — so the reply
     * has come back wearing `<<<END>>>` and a following section marker, which
     * then travelled all the way into a WordPress FAQ block.
     */
    const body = stripDelimiters(
      raw.replace(/^```(?:markdown)?\s*/i, "").replace(/```\s*$/i, "").trim(),
    );

    // Only accept a genuine expansion; a shorter "rewrite" is a regression.
    if (wordsOf(body) > wordsOf(written[section.key] ?? "")) {
      written[section.key] = body;
      ctx.log("expanded", { section: section.key, words: wordsOf(body) });
    }
  }

  state.expanded = true;
  const after = Object.values(written).reduce((sum, md) => sum + wordsOf(md ?? ""), 0) + faqWords;
  state.words = { target: plan.targetWords, actual: after };

  return { kind: "done", output: { sections: thin.map((t) => t.section.key), words: after } };
}
