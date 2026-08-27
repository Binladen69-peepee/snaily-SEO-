/**
 * The stages that turn written sections into a saved draft.
 *
 * Two of them cost nothing at all. Linking and style checking are measurement
 * problems, not writing problems: the site's real post list and the author's
 * real affiliate rows already say what every anchor should be, and the house
 * style rules are countable. Spending model tokens to approximate an answer
 * that is sitting in the database is the expensive kind of wrong.
 */

import { clip } from "@/lib/ai-policy";
import {
  applyAffiliateLinks,
  buildAffiliateIndex,
} from "@/lib/content/affiliate";
import {
  findRawLinkArtifacts,
  insertInternalLinks,
} from "@/lib/content/internal-links";
import { buildLinkIndex } from "@/lib/content/link-index";
import { prisma } from "@/lib/db";
import { parseEditorial, pushRevision, slugFromTitle } from "@/lib/drafter/editorial";
import { checkDraftQuality } from "@/lib/drafter/quality-gate";
import { sanitizeEditorHtml, stripPipelineMarkers } from "@/lib/drafter/sanitize";
import { SLANG_ALLOWLIST } from "@/lib/drafter/style";
import {
  formatTermList,
  resolveCategories,
  type SiteTerm,
} from "@/lib/drafter/categories";
import { evidenceFrom, gateCuisines } from "@/lib/drafter/cuisine-gate";
import { factBuckets, styleContext } from "@/lib/drafter/context-buckets";
import { providerDisplayName, researchSliceForSections } from "@/lib/drafter/research";
import { briefFor } from "@/lib/drafter/voice";
import type { WriterKey } from "@/lib/drafter/voice/types";
import { formatIngredients, formatSteps } from "@/lib/drafter/recipe-paste";
import { parseRecipe } from "@/lib/drafter/recipe";
import { benchmark } from "@/lib/drafter/style-benchmark";
import {
  failingSections,
  hardFailIssues,
  splitSections,
  type StyleIssue,
} from "@/lib/drafter/style-check";
import type { SectionKey } from "@/lib/wordpress/sections";
import { StageFailure, type StageContext, type StageResult } from "@/lib/jobs/context";
import {
  chunkByHeading,
  composeHtml,
  normaliseDashes,
  stripPlaceholderBlocks,
  htmlToCompact,
  maskAnchors,
  proseWords,
  totalWords,
  unmaskAnchors,
} from "@/lib/jobs/compose";

/** Builds the document the first time a stage needs one. */
function ensureHtml(ctx: StageContext): string {
  const existing = ctx.state.html ?? "";
  if (existing.trim() !== "") return existing;

  const built = composeHtml(ctx.state);
  ctx.state.html = built;
  return built;
}

/** Title + keyword + paste, so leak-term checks can tell Tamale Pie from this dish. */
function recipeSourceText(ctx: StageContext, ingredients: string[]): string {
  const parsed = ctx.state.parsed;
  const posts = ctx.state.research?.internalPosts ?? [];
  return [
    ctx.article.title,
    ctx.article.keyword,
    ...(parsed?.ingredients ?? ingredients),
    ...(parsed?.steps ?? []),
    ...posts.map((p) => p.title),
  ].join(" ");
}

function factsForRewrite(ctx: StageContext, key?: SectionKey | null): string {
  const parsed = ctx.state.parsed;
  const research = ctx.state.research;
  if (parsed === undefined) return "";
  const skipResearch = key === "how-to-make" || key === "tips";
  const sliceKey =
    key === "how-to-make"
      ? "steps"
      : key === "faqs"
        ? "faq"
        : (key ?? "intro");
  const slice = skipResearch
    ? {}
    : researchSliceForSections(research?.drafter, [sliceKey], {
        recipeText: [
          ctx.article.title,
          ctx.article.keyword,
          ...parsed.ingredients,
          ...parsed.steps,
        ].join(" "),
      });
  return factBuckets({
    title: ctx.article.title,
    keyword: ctx.article.keyword,
    ingredients: formatIngredients(parsed),
    steps: formatSteps(parsed),
    terms: slice.terms,
    questions: slice.questions,
    intent: slice.intent,
    titleTerms: slice.titleTerms,
    researchNote: slice.note,
    researchProvider: research?.drafter
      ? providerDisplayName(research.drafter.provider)
      : undefined,
    posts: research?.internalPosts.slice(0, 24),
  });
}

/* -------------------------------------------------------------------------
 * 8. Internal links
 * ---------------------------------------------------------------------- */

export async function internalLinks(ctx: StageContext): Promise<StageResult> {
  const html = ensureHtml(ctx);
  const index = await buildLinkIndex(ctx.article.projectId);

  if (index.all.length === 0) {
    return {
      kind: "skipped",
      reason: "No published WordPress posts are synced, so there is nothing verified to link to.",
    };
  }

  const result = insertInternalLinks(html, index);
  ctx.state.html = result.html;
  ctx.state.links = {
    internal: result.inserted.length,
    affiliate: ctx.state.links?.affiliate ?? 0,
    unresolved: result.unmatched.length,
    unresolvedSamples: result.unmatched.slice(0, 5),
  };

  ctx.log("internal_links", {
    inserted: result.inserted.length,
    candidates: index.all.length,
  });

  return {
    kind: "done",
    output: {
      inserted: result.inserted.length,
      samples: result.inserted.slice(0, 5).map((i) => i.anchor),
    },
  };
}

/* -------------------------------------------------------------------------
 * 9. Affiliate links
 * ---------------------------------------------------------------------- */

export async function affiliateLinks(ctx: StageContext): Promise<StageResult> {
  const html = ensureHtml(ctx);
  const index = await buildAffiliateIndex(ctx.article.projectId);

  if (index.terms.length === 0) {
    return {
      kind: "skipped",
      reason:
        "No affiliate links are available for this project. Sync Easy Affiliate Links from WordPress first.",
    };
  }

  const result = applyAffiliateLinks(html, index);
  ctx.state.html = result.html;
  ctx.state.links = {
    internal: ctx.state.links?.internal ?? 0,
    affiliate: result.linked.length,
    unresolved: ctx.state.links?.unresolved ?? 0,
    unresolvedSamples: ctx.state.links?.unresolvedSamples ?? [],
  };

  ctx.log("affiliate_links", {
    linked: result.linked.length,
    terms: index.terms.length,
  });

  return {
    kind: "done",
    output: {
      linked: result.linked.length,
      samples: result.linked.slice(0, 5).map((l) => l.term),
    },
  };
}

/* -------------------------------------------------------------------------
 * 10. SEO metadata
 * ---------------------------------------------------------------------- */

function firstLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function metadata(ctx: StageContext): Promise<StageResult> {
  const html = ensureHtml(ctx);
  const { article, state } = ctx;

  /*
   * Filing the post on the shelves the site actually has.
   *
   * Read here rather than guessed: the model is shown the real names and every
   * answer is matched back against them, so a category that does not exist
   * cannot reach WordPress. An empty list is the correct outcome when nothing
   * matches, and is what the author sees rather than a made-up term.
   */
  const [categoryRows, tagRows] = await Promise.all([
    prisma.wpTerm.findMany({
      where: { projectId: article.projectId, taxonomy: "category" },
      orderBy: { count: "desc" },
      select: { name: true, count: true },
    }),
    prisma.wpTerm.findMany({
      where: { projectId: article.projectId, taxonomy: "post_tag" },
      orderBy: { count: "desc" },
      select: { name: true, count: true },
    }),
  ]);
  const siteCategories: SiteTerm[] = categoryRows;
  const siteTags: SiteTerm[] = tagRows;

  const system = [
    "You write the search listing for a vegan recipe blog post, as Adam of The Cinnamon Snail.",
    styleContext([state.styleBrief]),
    briefFor(["seo"]),
    "No em dashes. Never promise anything the article does not deliver.",
  ].join("\n\n");

  const wantsTerms = siteCategories.length > 0;

  const titleTerms = (state.research?.drafter?.titleTerms ?? [])
    .filter((t) => t.relevance !== "low")
    .slice(0, 12)
    .map((t) => t.term);

  const user = [
    `Return exactly these ${wantsTerms ? "eight" : "five"} lines and nothing else:`,
    "TITLE: the post title, under 65 characters, containing the primary keyword",
    "SEO_TITLE: the search-result title, under 60 characters",
    "DESCRIPTION: the meta description, 140-155 characters",
    "SLUG: lowercase-hyphenated, 3-6 words, containing the primary keyword",
    "EXCERPT: one sentence for the blog index, under 160 characters",
    ...(wantsTerms
      ? [
          "PRIMARY: exactly one category name, copied character for character from the list below",
          "OTHER: up to 3 more category names from the same list, comma separated",
          `TAGS: ${siteTags.length > 0 ? "up to 3 tag names from the tag list, or the word none" : "none"}`,
        ]
      : []),
    "",
    ...(wantsTerms
      ? [
          "Categories on this site — choose only from these, never invent one:",
          formatTermList(siteCategories),
          ...(siteTags.length > 0
            ? ["", "Tags on this site:", formatTermList(siteTags, 40)]
            : []),
          "",
        ]
      : []),
    `Primary keyword: ${article.keyword}`,
    `Current working title: ${article.title}`,
    titleTerms.length > 0
      ? `Recurring terms in top-15 SERP titles (use naturally, do not stuff): ${titleTerms.join(", ")}`
      : "",
    state.research?.drafter
      ? `Search research source: ${providerDisplayName(state.research.drafter.provider)}`
      : "",
    `The article:\n${clip(htmlToCompact(html), 5_000)}`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const raw = await ctx.ai({
    system,
    user,
    maxTokens: wantsTerms ? 420 : 300,
    temperature: 0.5,
  });

  const field = (name: string): string => {
    const m = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(raw);
    return (m?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  };

  const workingTitle = field("TITLE") || article.title;
  const slug = slugFromTitle(field("SLUG") || workingTitle);

  const terms = wantsTerms
    ? resolveCategories(raw, siteCategories, siteTags)
    : { categories: [], tags: [], rejected: [] };

  /*
   * A category has to be true, not merely real.
   *
   * Every name above already exists on the site, which is what the check was
   * for and is not enough: a Vietnamese banh mi went out filed under Mexican,
   * Thai and Italian, all three real shelves, none of them mentioned once in
   * its own text. The recipe card then derives its cuisine from these, so a
   * wrong shelf becomes a wrong factual claim in structured data.
   *
   * The article's own words are the evidence. A cuisine it never mentions is
   * dropped; the one it argues for repeatedly is used instead.
   */
  const evidence = evidenceFrom({
    title: workingTitle,
    keyword: article.keyword ?? "",
    recipe: article.recipe ?? "",
    html,
  });

  // What the dish IS, separate from what the prose says it goes with.
  const identity = [workingTitle, article.keyword ?? "", article.recipe ?? ""].join(
    " ",
  );

  const gated = wantsTerms
    ? gateCuisines(terms.categories, siteCategories, evidence, identity)
    : { categories: terms.categories, dropped: [], added: null };

  if (gated.dropped.length > 0 || gated.added !== null) {
    ctx.log("cuisine_gate", {
      dropped: gated.dropped.map((d) => d.name).join(",") || "none",
      added: gated.added ?? "none",
    });
  }

  state.metadata = {
    workingTitle,
    seoTitle: firstLine(field("SEO_TITLE") || workingTitle, 60),
    metaDescription: firstLine(field("DESCRIPTION"), 160),
    slug,
    excerpt: firstLine(field("EXCERPT"), 200),
    categories: gated.categories,
    tags: terms.tags,
    rejectedTerms: terms.rejected,
  };

  /*
   * A metadata stage that returns nothing usable is a failure, not a partial
   * success. The old pipeline extracted the title from the draft and silently
   * got "" — which then travelled all the way to WordPress as an untitled
   * post, because every step after it treated empty as "leave it alone".
   */
  if (state.metadata.workingTitle.trim() === "") {
    throw new StageFailure("no_title", "The metadata stage produced no title.", true);
  }

  ctx.log("metadata", {
    titleChars: state.metadata.workingTitle.length,
    descriptionChars: state.metadata.metaDescription.length,
    slug: state.metadata.slug,
    categories: terms.categories.join(" / "),
    rejected: terms.rejected.length,
  });

  return { kind: "done", output: { ...state.metadata } };
}

/* -------------------------------------------------------------------------
 * 11. Style QA
 * ---------------------------------------------------------------------- */

/** How many published posts the draft is measured against. */
const CORPUS_SIZE = 6;

/** At most this many sections are rewritten in one pass. */
const MAX_SECTION_REWRITES = 3;

/**
 * Measures the draft against the author's own published posts, and repairs it.
 *
 * The old pass counted banned words and reported them for the author to fix.
 * That caught the vocabulary and missed what they actually noticed: every
 * sentence the same length, adjectives standing in for detail, an invented
 * memory, an ingredient the recipe does not contain. Those are found here
 * deterministically, attributed to a section, and only the failing sections are
 * rewritten - a whole-article regeneration would throw away the parts that were
 * already right and cost a second article's tokens to do it.
 */
export async function styleQa(ctx: StageContext): Promise<StageResult> {
  const html = ensureHtml(ctx);
  const { article, state } = ctx;

  const dashes = normaliseDashes(html);
  let out = dashes.html;

  const [corpusRows, recipeRow] = await Promise.all([
    prisma.wpPost.findMany({
      where: { projectId: article.projectId, status: "publish", type: "post" },
      orderBy: { publishedAt: "desc" },
      take: CORPUS_SIZE,
      select: { content: true },
    }),
    prisma.article.findUnique({
      where: { id: article.id },
      select: { recipeCard: true },
    }),
  ]);

  const corpus = corpusRows.map((r) => r.content).filter((c) => c.trim() !== "");
  const recipeIngredients = parseRecipe(recipeRow?.recipeCard).ingredients;

  const before = benchmark({
    html: out,
    recipeIngredients,
    recipeText: recipeSourceText(ctx, recipeIngredients),
    corpus,
  });

  /*
   * Repair, section by section, worst first.
   *
   * Checkpointed after every section, because a worker that runs out of its
   * per-minute token allowance yields and the stage starts again from the top.
   * Without the record of what had already been rewritten this pass re-measured
   * and re-rewrote on every resume - sixteen model calls into one stage and
   * still not finished.
   *
   * A section is only replaced when the rewrite comes back with every number,
   * every link and roughly the same amount of writing intact. Anything else
   * keeps the original: a flat paragraph is a disappointment, and a rewrite
   * that quietly dropped a temperature is a defect.
   */
  state.styleQa ??= { rewritten: [], done: false };
  const rewritten = state.styleQa.rewritten;

  const targets = failingSections(before.issues)
    .filter((key) => !rewritten.includes(key ?? "intro"))
    .slice(0, Math.max(0, MAX_SECTION_REWRITES - rewritten.length));

  for (const key of targets) {
    if (ctx.outOfTime()) {
      state.html = out;
      return {
        kind: "partial",
        note: `${String(rewritten.length)} section(s) repaired`,
      };
    }

    const section = splitSections(out).find((s) => s.key === key);
    if (section === undefined) {
      rewritten.push(key ?? "intro");
      continue;
    }

    const reasons = before.issues
      .filter((i) => i.section === key)
      .map((i) => `- ${i.rule}: ${i.detail} — "${i.evidence}"`);

    const repaired = await rewriteSection(ctx, section.html, key, reasons);

    // Recorded either way: a rewrite that failed its checks is not retried,
    // or the stage would spend the rest of the job asking again.
    rewritten.push(key ?? "intro");
    if (repaired === null) continue;

    out = out.replace(section.html, repaired);
    state.html = out;
  }

  state.styleQa.done = true;

  const after =
    rewritten.length === 0
      ? before
      : benchmark({
          html: out,
          recipeIngredients,
          recipeText: recipeSourceText(ctx, recipeIngredients),
          corpus,
        });

  state.html = out;
  state.style = [
    ...(dashes.changed > 0
      ? [
          {
            rule: "no em dashes",
            detail: "Replaced with plain hyphens.",
            count: dashes.changed,
          },
        ]
      : []),
    ...after.issues.map((i) => ({
      rule: i.rule,
      detail: `${i.detail} (${i.section ?? "intro"})`,
      count: 1,
    })),
  ];
  state.benchmark = {
    styleMatch: after.styleMatch,
    genericAi: after.genericAi,
    grounding: after.grounding,
    sectionCompliance: after.sectionCompliance,
    recipeAccuracy: after.recipeAccuracy,
    inventedClaims: after.inventedClaims,
    passed: after.passed,
    rewritten,
  };

  ctx.log("style_qa", {
    styleMatch: `${String(before.styleMatch)} -> ${String(after.styleMatch)}`,
    genericAi: `${String(before.genericAi)} -> ${String(after.genericAi)}`,
    inventedClaims: after.inventedClaims,
    grounding: after.grounding,
    sectionCompliance: after.sectionCompliance,
    rewritten: rewritten.join(",") || "none",
    dashesFixed: dashes.changed,
  });

  return {
    kind: "done",
    output: {
      styleMatch: after.styleMatch,
      genericAi: after.genericAi,
      grounding: after.grounding,
      sectionCompliance: after.sectionCompliance,
      recipeAccuracy: after.recipeAccuracy,
      inventedClaims: after.inventedClaims,
      passed: after.passed,
      rewritten,
      issues: after.issues.slice(0, 12).map((i) => `${i.rule}: ${i.detail}`),
    },
  };
}

/** Maps a document section back onto the writer that knows how it sounds. */
const WRITER_FOR: Partial<Record<string, WriterKey>> = {
  why: "why",
  ingredients: "ingredients",
  variations: "variations",
  "how-to-make": "steps",
  serving: "serving",
  tips: "tips",
  faqs: "faq",
  related: "related",
};

/**
 * Rewrites one section against its own writer brief and its own failures.
 *
 * Anchors are masked before the model sees them, as the proofreading stage
 * does, so a rewrite can cost a sentence but never a link. Every number in the
 * original has to survive, and so does every heading - the export maps sections
 * by heading wording, and a rewrite that improved a heading would silently
 * unmap the section on the way to WordPress.
 */
async function rewriteSection(
  ctx: StageContext,
  sectionHtml: string,
  key: SectionKey | null,
  reasons: string[],
): Promise<string | null> {
  const writerKey = key === null ? "intro" : WRITER_FOR[key];
  if (writerKey === undefined) return null;

  const headings = [...sectionHtml.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(
    (m) => m[0],
  );
  const numbers = sectionHtml.replace(/<[^>]+>/g, " ").match(/\d+(?:[.,/]\d+)?/g) ?? [];
  const masked = maskAnchors(sectionHtml);

  const system = [
    "You are Adam of The Cinnamon Snail, rewriting one section of your own draft.",
    styleContext([ctx.state.styleBrief]),
    briefFor([writerKey]),
    [
      "Return the same HTML structure: the same tags, the same headings, in the same order.",
      "Keep every ⟦n⟧ marker exactly where it is - they are links.",
      "Keep every number, measurement, time and temperature exactly as written.",
      "Change the writing, not the facts and not the shape.",
      "Facts only from RECIPE_CONTEXT. STYLE_CONTEXT is rhythm, not ingredients.",
      "Return only the HTML. No commentary, no code fence, no <<< markers.",
    ].join("\n"),
  ].join("\n\n");

  const user = [
    factsForRewrite(ctx, key),
    "",
    "This section was flagged for:",
    ...reasons,
    "",
    "Rewrite it so those are gone and it reads like the STYLE_CONTEXT examples.",
    "Do not import an ingredient, method, or tester story from those examples.",
    "",
    masked.text,
  ].join("\n");

  const raw = await ctx.ai({ system, user, maxTokens: 1_600, temperature: 0.75 });
  const cleaned = raw
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (cleaned === "") return null;

  const restored = unmaskAnchors(cleaned, masked.hrefs);
  if (restored === null) return null;
  const stripped = stripPipelineMarkers(restored);

  const plain = stripped.replace(/<[^>]+>/g, " ");
  if (!numbers.every((n) => plain.includes(n))) return null;
  for (const heading of headings) {
    if (!stripped.includes(heading)) return null;
  }

  const originalWords = proseWords(sectionHtml);
  const newWords = proseWords(stripped);
  if (originalWords > 0 && (newWords < originalWords * 0.65 || newWords > originalWords * 1.5)) {
    return null;
  }

  return stripped;
}

/* -------------------------------------------------------------------------
 * 12. Proofread
 * ---------------------------------------------------------------------- */

/** Chunk size that leaves room for the reply under the per-request ceiling. */
const PROOF_CHUNK_CHARS = 4_500;

export async function proofread(ctx: StageContext): Promise<StageResult> {
  const html = ensureHtml(ctx);
  const { article, state } = ctx;

  state.proof ??= { pending: chunkByHeading(html, PROOF_CHUNK_CHARS), done: [] };

  const editorial = parseEditorial(
    (
      await prisma.article.findUnique({
        where: { id: article.id },
        select: { editorial: true },
      })
    )?.editorial,
  );

  const system = [
    "You are proofreading a Cinnamon Snail recipe post as Adam.",
    `Keep this slang exactly when it appears: ${SLANG_ALLOWLIST.slice(0, 14).join(", ")}.`,
    "Keep foreign and transliterated recipe words and their diacritics. Never Anglicise them.",
    editorial.protectedVocab.length > 0
      ? `Never 'correct' these: ${editorial.protectedVocab.join(", ")}.`
      : "",
    "Do not rewrite the voice. Do not add, remove or reorder anything.",
    "Fix only: typos, doubled words, broken agreement, missing punctuation.",
    "Never introduce an em dash or an en dash. Clauses join with a plain hyphen.",
    "The text contains markers like ⟦3⟧word⟦/3⟧. Reproduce every marker exactly,",
    "in the same order, around the same words. They are links.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  let rejected = 0;

  while (state.proof.pending.length > 0) {
    if (ctx.outOfTime()) {
      return {
        kind: "partial",
        note: `${String(state.proof.done.length)}/${String(
          state.proof.done.length + state.proof.pending.length,
        )}`,
      };
    }

    const chunk = state.proof.pending[0]!;
    const masked = maskAnchors(chunk);

    const raw = await ctx.ai({
      system,
      user: [
        "Return the corrected HTML for this passage and nothing else.",
        "No commentary, no code fence, no list of changes.",
        "",
        masked.text,
      ].join("\n"),
      maxTokens: 2_000,
      temperature: 0.1,
    });

    const cleaned = raw
      .replace(/^```(?:html|markdown)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const restored = unmaskAnchors(cleaned, masked.hrefs);

    /*
     * A chunk whose links did not survive is discarded whole. Proofreading is
     * worth a few typos; it is not worth an anchor whose href the model
     * rewrote, and there is no way to tell a dropped link from a deliberate
     * edit after the fact.
     */
    if (restored === null || restored.trim() === "") {
      rejected += 1;
      state.proof.done.push(chunk);
    } else {
      state.proof.done.push(restored);
    }

    state.proof.pending.shift();
  }

  state.html = state.proof.done.join("");
  const chunks = state.proof.done.length;
  delete state.proof;

  ctx.log("proofread", { chunks, rejected });

  return { kind: "done", output: { chunks, rejected } };
}

/* -------------------------------------------------------------------------
 * 13. Completeness QA
 * ---------------------------------------------------------------------- */

export async function completeness(ctx: StageContext): Promise<StageResult> {
  const { state } = ctx;
  const plan = state.outline;
  await Promise.resolve();

  const stripped = stripPlaceholderBlocks(ensureHtml(ctx));
  state.html = stripped.html;

  const report = checkDraftQuality(state.html);
  const problems: string[] = report.issues.map((i) => i.message);

  /*
   * Structural checks the regex gate cannot make, because they depend on what
   * this particular post was planned to contain rather than on what a post
   * generally looks like.
   */
  const headings = [...state.html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) =>
    (m[1] ?? "").replace(/<[^>]+>/g, "").trim().toLowerCase(),
  );

  if (plan !== undefined) {
    for (const section of plan.sections) {
      if (section.key === "intro" || section.heading === "") continue;
      const stem = section.heading
        .replace(/^\s*\p{Extended_Pictographic}+\s*/u, "")
        .toLowerCase()
        .slice(0, 12);
      if (stem !== "" && !headings.some((h) => h.includes(stem))) {
        problems.push(`The "${section.heading}" section is missing from the draft.`);
      }
    }
  }

  if ((state.faq ?? []).length === 0) {
    problems.push("The FAQ section has no questions.");
  }

  if ((state.metadata?.workingTitle ?? "").trim() === "") {
    problems.push("The post has no title.");
  }
  if ((state.metadata?.metaDescription ?? "").trim() === "") {
    problems.push("The post has no meta description.");
  }

  const artifacts = findRawLinkArtifacts(state.html);
  if (artifacts.length > 0) {
    problems.push(
      `Raw links or Markdown link syntax left in the prose: ${artifacts.slice(0, 3).join(", ")}`,
    );
  }

  state.quality = report;
  state.words = {
    target: plan?.targetWords ?? 0,
    actual: proseWords(state.html),
  };

  ctx.log("completeness", {
    ok: problems.length === 0,
    problems: problems.length,
    proseWords: state.words.actual,
    headings: report.stats.headings,
    placeholdersRemoved: stripped.removed,
  });

  /*
   * Reported, never fatal. The draft is the author's work by this point and a
   * failed check must not be the reason they cannot see it — the editor shows
   * the warnings alongside the article, and the stage that saves it runs
   * regardless.
   */
  return {
    kind: "done",
    output: {
      ok: problems.length === 0,
      problems: problems.slice(0, 8),
      proseWords: state.words.actual,
      targetWords: state.words.target,
      placeholdersRemoved: stripped.removed,
    },
  };
}

/* -------------------------------------------------------------------------
 * 14. Final assembly
 * ---------------------------------------------------------------------- */

export async function assemble(ctx: StageContext): Promise<StageResult> {
  await Promise.resolve();
  const html = ensureHtml(ctx);

  let out = sanitizeEditorHtml(html);

  /*
   * The dash sweep runs here as well as in the style check, and this is the one
   * that counts: proofreading happens in between, and a model handed a hyphen
   * puts an em dash back roughly every other section. Doing it last means the
   * rule holds regardless of what any earlier stage did.
   */
  const dashes = normaliseDashes(out);
  out = dashes.html;

  // An H1 in the body competes with the post title WordPress already renders.
  out = out.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, "<h2>$1</h2>");
  out = out.replace(/(<\/(?:p|h[23]|ul|ol|blockquote)>)\s*/gi, "$1\n").trim();

  ctx.state.html = out;
  ctx.state.words = {
    target: ctx.state.words?.target ?? 0,
    actual: proseWords(out),
  };

  ctx.log("assembled", {
    chars: out.length,
    words: totalWords(out),
    proseWords: ctx.state.words.actual,
    dashesFixed: dashes.changed,
    markersStripped: html.includes("<<<") && !out.includes("<<<"),
  });

  return {
    kind: "done",
    output: {
      chars: out.length,
      proseWords: ctx.state.words.actual,
      dashesFixed: dashes.changed,
    },
  };
}

/* -------------------------------------------------------------------------
 * 15. Voice + grounding QA
 * ---------------------------------------------------------------------- */

/**
 * Last editorial gate before the draft is saved.
 *
 * Style-qa rewrites and reports. Completeness never fatals. Markers have
 * still shipped. This stage strips them after assembly, scores the five
 * things the client asked for, rewrites once, strips invented sentences
 * programmatically, then hard-fails if a lie, a leaked recipe, a marker or
 * a named generic metaphor is still on the page.
 *
 * The HTML is written to the article first so a failed gate is not the
 * reason the author cannot see the draft.
 */
export async function voiceQa(ctx: StageContext): Promise<StageResult> {
  let html = stripPipelineMarkers(sanitizeEditorHtml(ensureHtml(ctx)));
  const { article, state } = ctx;

  const [corpusRows, recipeRow] = await Promise.all([
    prisma.wpPost.findMany({
      where: { projectId: article.projectId, status: "publish", type: "post" },
      orderBy: { publishedAt: "desc" },
      take: CORPUS_SIZE,
      select: { content: true },
    }),
    prisma.article.findUnique({
      where: { id: article.id },
      select: { recipeCard: true },
    }),
  ]);

  const corpus = corpusRows.map((r) => r.content).filter((c) => c.trim() !== "");
  const recipeIngredients = parseRecipe(recipeRow?.recipeCard).ingredients;
  const recipeText = recipeSourceText(ctx, recipeIngredients);
  const score = (doc: string) =>
    benchmark({ html: doc, recipeIngredients, recipeText, corpus });

  let scored = score(html);
  state.voiceQa ??= {
    voiceMatch: scored.styleMatch,
    grounding: scored.grounding,
    genericAi: scored.genericAi,
    sectionCompliance: scored.sectionCompliance,
    recipeAccuracy: scored.recipeAccuracy,
    passed: false,
    rewritten: [],
    issues: [],
  };
  const rewritten = state.voiceQa.rewritten;

  const targets =
    hardFailIssues(scored.issues).length === 0
      ? []
      : failingSections(scored.issues)
          .filter((key) => !rewritten.includes(key ?? "intro"))
          .slice(0, Math.max(0, 3 - rewritten.length));

  for (const key of targets) {
    if (ctx.outOfTime()) {
      state.html = html;
      return { kind: "partial", note: "voice-qa" };
    }

    const section = splitSections(html).find((s) => s.key === key);
    if (section === undefined) {
      rewritten.push(key ?? "intro");
      continue;
    }

    const reasons = scored.issues
      .filter((i) => i.section === key)
      .map((i) => `- ${i.rule}: ${i.detail} — "${i.evidence}"`);

    const repaired = await rewriteSection(ctx, section.html, key, reasons);
    rewritten.push(key ?? "intro");
    if (repaired !== null) {
      html = html.replace(section.html, repaired);
    }
    state.html = html;
    state.voiceQa.rewritten = rewritten;
  }

  html = stripPipelineMarkers(sanitizeEditorHtml(html));
  html = stripEvidenceParagraphs(html, hardFailIssues(score(html).issues));
  html = stripPipelineMarkers(html);

  scored = score(html);
  const hard = hardFailIssues(scored.issues);

  state.html = html;
  state.voiceQa = {
    voiceMatch: scored.styleMatch,
    grounding: scored.grounding,
    genericAi: scored.genericAi,
    sectionCompliance: scored.sectionCompliance,
    recipeAccuracy: scored.recipeAccuracy,
    passed: hard.length === 0,
    rewritten,
    issues: hard.map((i) => `${i.rule}: ${i.detail}`),
  };

  await persistDraftBody(ctx, html);

  ctx.log("voice_qa", {
    voiceMatch: scored.styleMatch,
    grounding: scored.grounding,
    genericAi: scored.genericAi,
    sectionCompliance: scored.sectionCompliance,
    recipeAccuracy: scored.recipeAccuracy,
    passed: hard.length === 0,
    rewritten: rewritten.join(",") || "none",
    hardFails: hard.length,
  });

  if (hard.length > 0) {
    throw new StageFailure(
      "voice_grounding",
      hard
        .slice(0, 6)
        .map((i) => `${i.rule}: ${i.detail}`)
        .join(" "),
      false,
    );
  }

  return { kind: "done", output: { ...state.voiceQa } };
}

/** Drops the paragraph that carries a hard-fail sentence. Better blank than a lie. */
function stripEvidenceParagraphs(html: string, issues: StyleIssue[]): string {
  let out = html;
  for (const issue of issues) {
    const needle = issue.evidence.replace(/…$/, "").trim();
    if (needle.length < 12) continue;
    out = out.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, (block) => {
      const text = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      return text.includes(needle.slice(0, 48)) ? "" : block;
    });
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

async function persistDraftBody(ctx: StageContext, html: string): Promise<void> {
  await prisma.article.update({
    where: { id: ctx.article.id },
    data: { content: html, generated: html },
  });
}

/* -------------------------------------------------------------------------
 * 16. Save
 * ---------------------------------------------------------------------- */

export async function save(ctx: StageContext): Promise<StageResult> {
  const { article, state } = ctx;
  const html = (state.html ?? "").trim();

  if (html === "") {
    throw new StageFailure("nothing_to_save", "The pipeline produced no article body.");
  }

  const current = await prisma.article.findUnique({
    where: { id: article.id },
    select: { title: true, editorial: true, revisions: true, content: true },
  });
  if (current === null) {
    throw new StageFailure("article_gone", "The article was deleted while it was generating.");
  }

  /*
   * The author's title wins.
   *
   * If it still reads exactly as it did when the job started, nobody has
   * touched it and the generated title is an improvement. If it changed while
   * the job was running, they renamed it — and silently replacing that with a
   * model's phrasing is the sort of thing that makes people stop trusting a
   * generate button.
   */
  const untouched = current.title === (state.titleAtStart ?? current.title);
  const title = untouched ? (state.metadata?.workingTitle ?? current.title) : current.title;

  const editorial = parseEditorial(current.editorial);
  const meta = state.metadata;

  const merged = {
    ...editorial,
    // Only fill what the author has left empty; never overwrite their wording.
    seoTitle: editorial.seoTitle || (meta?.seoTitle ?? ""),
    seoDescription: editorial.seoDescription || (meta?.metaDescription ?? ""),
    slug: editorial.slug || (meta?.slug ?? ""),
    excerpt: editorial.excerpt || (meta?.excerpt ?? ""),
    categories:
      editorial.categories.length > 0 ? editorial.categories : (meta?.categories ?? []),
    tags: editorial.tags.length > 0 ? editorial.tags : (meta?.tags ?? []),
  };

  await prisma.article.update({
    where: { id: article.id },
    data: {
      title,
      content: html,
      generated: html,
      editorial: merged,
      phase: "draft",
      status: "draft",
      revisions: pushRevision(current.revisions, {
        kind: "outline",
        title,
        content: html,
      }),
    },
  });

  ctx.log("saved", {
    articleId: article.id,
    chars: html.length,
    titleKept: !untouched,
  });

  return {
    kind: "done",
    output: { chars: html.length, title, authorTitleKept: !untouched },
  };
}
