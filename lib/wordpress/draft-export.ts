import { prisma } from "@/lib/db";
import {
  applyAffiliateLinks,
  buildAffiliateIndex,
  type AffiliateResult,
} from "@/lib/content/affiliate";
import {
  buildLinkIndex,
  resolveLinks,
  type LinkIndex,
} from "@/lib/content/link-index";
import {
  resolveRelatedPosts,
  type RelatedPost,
} from "@/lib/drafter/related-posts";
import {
  buildArticleDocument,
  excerptFor,
  type ArticleDocument,
} from "@/lib/drafter/document";
import { parseEditorial, type EditorialMeta } from "@/lib/drafter/editorial";
import { sanitizeEditorHtml } from "@/lib/drafter/sanitize";
import { stripPlaceholders } from "@/lib/drafter/post-template";
import { parseRecipe, recipeScriptTag } from "@/lib/drafter/recipe";
import { buildRecipePayload } from "@/lib/wordpress/recipe-card";
import { toEditorHtml } from "@/lib/markdown";
import {
  createDraft,
  updateDraft,
  WordPressError,
  type WpDraftPayload,
  type WpRecipeReport,
  type WpSeoReport,
} from "@/lib/wordpress/client";
import {
  populateTemplate,
  readArticle,
  type ArticleContent,
  type MappingReport,
} from "@/lib/wordpress/section-mapper";
import {
  resolveTemplate,
  TemplateNotFound,
  type ResolvedTemplate,
} from "@/lib/wordpress/template";

/**
 * Turning a finished Drafter article into a WordPress draft.
 *
 * The shape of this is fixed by the client's workflow: duplicate their real
 * Blog Post Template, populate its sections, save as a draft, never publish.
 * Everything here runs before a single write reaches the site, so the preview
 * the author confirms and the draft that gets created come from exactly the
 * same computation - `buildExport` does the work, `sendExport` posts it.
 */

/* ---------------------------------------------------------------------------
 * Draft-only safety
 * ------------------------------------------------------------------------ */

export class PublishRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishRefused";
  }
}

/**
 * Refuses anything that is not a draft creation or a draft update.
 *
 * The connector plugin already hard-codes `post_status = draft` and rejects
 * published posts, so this is the second of two independent locks rather than
 * the only one. It exists because the expensive mistake here — overwriting a
 * live post, or publishing a half-finished draft — is not one a code review
 * should be the last line of defence against.
 */
export function assertDraftOnly(opts: {
  status: string;
  targetPostId: number | null;
  templatePostId: number;
  targetStatus?: string;
}): void {
  if (opts.status !== "draft") {
    throw new PublishRefused(
      `Refusing to export with status "${opts.status}". Drafter can only create drafts.`,
    );
  }

  if (opts.targetPostId !== null) {
    if (opts.targetPostId === opts.templatePostId) {
      throw new PublishRefused(
        "Refusing to write to the Blog Post Template itself. The template is duplicated, never edited.",
      );
    }
    if (opts.targetStatus !== undefined && opts.targetStatus !== "draft") {
      throw new PublishRefused(
        `Refusing to overwrite WordPress post ${String(opts.targetPostId)}, which is "${opts.targetStatus}", not a draft.`,
      );
    }
  }
}

/* ---------------------------------------------------------------------------
 * Link resolution
 * ------------------------------------------------------------------------ */

export type LinkReport = {
  internalResolved: { anchor: string; url: string }[];
  internalUnresolved: { anchor: string; href: string }[];
  affiliateLinked: { term: string; url: string; kind: "affiliate" | "internal" }[];
  /** Post IDs put into the Feast related-recipes grid. */
  relatedIds: { wpId: number; title: string }[];
};

/**
 * Recipes named in the closing section, resolved to real WordPress post IDs.
 *
 * The matching itself lives in lib/drafter/related-posts.ts, because the
 * document the author reads has to print the same four posts this sends. When
 * the two worked it out separately, the document listed names and the post
 * shipped a grid nobody had seen.
 */
function relatedPostIds(
  article: ArticleContent,
  index: LinkIndex,
): RelatedPost[] {
  const section = article.sections.get("related");
  if (!section) return [];
  return resolveRelatedPosts(index, section.body.map((el) => el.html).join("\n"));
}


/* ---------------------------------------------------------------------------
 * Building the export
 * ------------------------------------------------------------------------ */

export type ExportPlan = {
  template: { wpId: number; title: string; status: string; configured: boolean };
  /** Populated template markup, ready to send. */
  content: string;
  payload: WpDraftPayload;
  mapping: MappingReport;
  links: LinkReport;
  /** The card that will be created, or null when there is no recipe. */
  recipe: ReturnType<typeof buildRecipePayload>;
  /** Existing draft this would update, when the author has exported before. */
  targetPostId: number | null;
  meta: EditorialMeta;
};

export type ExportArticle = {
  id: string;
  title: string;
  content: string;
  editorial: unknown;
  recipeCard: unknown;
  projectId: string;
  wpDraftId: number | null;
  /** The post's target keyword, written into Yoast's focus keyphrase. */
  keyword?: string;
};

/**
 * Everything that happens before the network call.
 *
 * Pure with respect to WordPress: it reads the synced template and the link
 * indexes, and returns the exact draft that would be created. The preview
 * screen renders this, and the export sends it, so the checklist an author
 * confirms is never a description of a different computation.
 */
export async function buildExport(
  article: ExportArticle,
  opts: { update?: boolean } = {},
): Promise<ExportPlan> {
  const template: ResolvedTemplate = await resolveTemplate(article.projectId);
  const meta = parseEditorial(article.editorial);

  /*
   * One canonical document, built once. Every SEO value below is read off it
   * rather than re-derived here, so the meta description that reaches Yoast and
   * the excerpt that reaches WordPress are the same string by construction.
   */
  const doc: ArticleDocument = buildArticleDocument({
    title: article.title,
    keyword: article.keyword ?? "",
    content: article.content ?? "",
    recipeCard: article.recipeCard,
    editorial: article.editorial,
  });

  /*
   * Unfilled template prompts never leave the app. Shipping "Hook - three or
   * four sentences" into a post is worse than shipping an empty section.
   */
  let html = stripPlaceholders(sanitizeEditorHtml(toEditorHtml(article.content)));

  /* ---- Internal links: verified or dropped, never guessed ------------ */

  const index = await buildLinkIndex(article.projectId);
  let internalResolved: LinkReport["internalResolved"] = [];
  let internalUnresolved: LinkReport["internalUnresolved"] = [];

  if (index.all.length > 0) {
    const resolution = resolveLinks(html, index);
    html = resolution.html;
    internalResolved = resolution.resolved;
    internalUnresolved = resolution.unresolved;
  }

  /* ---- Affiliate links: the author's spreadsheet, or nothing --------- */

  let affiliate: AffiliateResult = { html, linked: [], skipped: [] };
  try {
    const affiliates = await buildAffiliateIndex(article.projectId);
    if (affiliates.terms.length > 0) affiliate = applyAffiliateLinks(html, affiliates);
  } catch {
    /* A missing spreadsheet must never cost the author their export. */
  }
  html = affiliate.html;

  /* ---- Populate the duplicated template ------------------------------ */

  const parsed = readArticle(html);
  const related = index.all.length > 0 ? relatedPostIds(parsed, index) : [];

  const { content, report } = populateTemplate(template.structure, parsed, {
    title: article.title,
    relatedIds: related.map((r) => r.wpId),
  });

  /*
   * Recipe structured data rides along only when the template has no WP Recipe
   * Maker block. Where it does — as the client's template does — WPRM emits
   * its own Recipe schema, and a second copy on the same page is a structured
   * data error rather than extra coverage.
   */
  const jsonLd = report.recipeCardPreserved
    ? ""
    : recipeScriptTag(parseRecipe(article.recipeCard));

  const body =
    jsonLd === "" ? content : `${content}\n\n<!-- wp:html -->\n${jsonLd}\n<!-- /wp:html -->`;

  /*
   * The recipe card.
   *
   * Built from the author's stored recipe, not from the article body — the
   * body is prose about the recipe and the card has to be the recipe. Null
   * when there is nothing to make a card from, which the connector reports
   * back rather than creating an empty one.
   */
  const recipe = buildRecipePayload(parseRecipe(article.recipeCard), {
    title: article.title,
  });

  const payload: WpDraftPayload = {
    title: article.title,
    content: body,
    /*
     * The client's mapping: meta description -> Yoast meta description AND the
     * WordPress excerpt. Taking both from one value is what stops a live post
     * showing two different summaries.
     */
    excerpt: excerptFor(doc, meta.excerpt),
    slug: doc.seo.slug,
    metaTitle: doc.seo.seoTitle,
    metaDescription: doc.seo.metaDescription,
    focusKeyword: doc.seo.focusKeyword,
    /*
     * Index and follow. A draft with noindex/nofollow set "for safety" ships
     * those Yoast flags onto the live post the moment the author hits Publish,
     * and post-level nofollow would throw away every internal link. The author
     * asked for both switches off.
     */
    robots: { noindex: false, nofollow: false },
    /*
     * Primary first: the connector writes categories[0] as Yoast's primary
     * category. `doc.categories` is built that way deliberately rather than
     * relying on whatever order the array happened to be stored in.
     */
    categories: doc.categories,
    tags: meta.tags,
    ...(recipe === null ? {} : { recipe }),
    // Deliberately no featuredMedia: images are the client's own workflow.
  };

  return {
    template: {
      wpId: template.wpId,
      title: template.title,
      status: template.status,
      configured: template.configured,
    },
    content,
    payload,
    mapping: report,
    links: {
      internalResolved,
      internalUnresolved,
      affiliateLinked: affiliate.linked,
      relatedIds: related,
    },
    recipe,
    targetPostId:
      opts.update === true && article.wpDraftId !== null && article.wpDraftId > 0
        ? article.wpDraftId
        : null,
    meta,
  };
}

export type ExportResult = {
  id: number;
  editLink: string;
  updated: boolean;
  plan: ExportPlan;
  /** What the site says it did with the WP Recipe Maker card. */
  recipe: WpRecipeReport;
  /** Yoast fields as stored on the site, when the connector returns them. */
  seo: WpSeoReport | null;
};

/**
 * Sends a built plan to WordPress as a draft.
 *
 * An update that the site refuses — an old plugin with no update route, or a
 * draft the author has since published — falls back to creating a new draft
 * rather than failing, because the author's work has to land somewhere.
 */
export async function sendExport(
  creds: { siteUrl: string; token: string },
  plan: ExportPlan,
): Promise<ExportResult> {
  assertDraftOnly({
    status: "draft",
    targetPostId: plan.targetPostId,
    templatePostId: plan.template.wpId,
  });

  if (plan.targetPostId !== null) {
    try {
      const updated = await updateDraft(
        creds.siteUrl,
        creds.token,
        plan.targetPostId,
        plan.payload,
      );
      return { ...updated, updated: true, plan };
    } catch (err) {
      const recoverable =
        err instanceof WordPressError &&
        (err.kind === "route_missing" ||
          /only update drafts|not_a_draft/i.test(err.message));
      if (!recoverable) throw err;
    }
  }

  const created = await createDraft(creds.siteUrl, creds.token, plan.payload);
  return { ...created, updated: false, plan };
}

/** Persisted so the editor can show what happened without re-running the map. */
export type ExportRecord = {
  templatePostId: number;
  templateTitle: string;
  draftId: number;
  editLink: string;
  status: "draft";
  at: string;
  sectionsPopulated: number;
  stepsMapped: number;
  faqsMapped: number;
  internalLinks: number;
  affiliateLinks: number;
  unresolvedInternal: { anchor: string; href: string }[];
  unmappedSections: { heading: string; words: number }[];
  imagesSkipped: number;
  needsReview: boolean;
  /** Categories and tags the draft was filed under, primary category first. */
  categories: string[];
  tags: string[];
  focusKeyword: string;
  /** The WP Recipe Maker card, as the site reported it. */
  recipeId: number;
  recipeIngredients: number;
  recipeInstructions: number;
  nutritionAttached: boolean;
  recipeNote: string;
};

/**
 * Compares what we sent with what WordPress stored.
 *
 * The plugin returns Yoast and WPRM as actually written. A silent mismatch
 * used to look like a successful export while focus keyword, robots flags
 * or the recipe card never landed.
 */
export function exportReadbackMismatch(result: ExportResult): boolean {
  const sent = result.plan.payload;
  const seo = result.seo;
  if (seo !== null) {
    if (sent.focusKeyword && seo.focusKeyword.toLowerCase() !== sent.focusKeyword.toLowerCase()) {
      return true;
    }
    if (seo.noindex === true || seo.nofollow === true) return true;
  }
  if (sent.recipe !== undefined && result.recipe.recipeId <= 0) return true;
  return false;
}

export function toExportRecord(
  result: ExportResult,
): ExportRecord {
  const { plan } = result;
  return {
    templatePostId: plan.template.wpId,
    templateTitle: plan.template.title,
    draftId: result.id,
    editLink: result.editLink,
    status: "draft",
    at: new Date().toISOString(),
    sectionsPopulated: plan.mapping.sections.filter((s) => s.blocksWritten > 0).length,
    stepsMapped: plan.mapping.stepsMapped,
    faqsMapped: plan.mapping.faqsMapped,
    internalLinks: plan.links.internalResolved.length,
    affiliateLinks: plan.links.affiliateLinked.length,
    unresolvedInternal: plan.links.internalUnresolved,
    unmappedSections: plan.mapping.unmapped,
    imagesSkipped: plan.mapping.localImagesSkipped,
    needsReview: plan.mapping.needsReview || exportReadbackMismatch(result),
    categories: plan.payload.categories ?? [],
    tags: plan.payload.tags ?? [],
    focusKeyword: plan.payload.focusKeyword ?? "",
    recipeId: result.recipe.recipeId,
    recipeIngredients: result.recipe.ingredientCount,
    recipeInstructions: result.recipe.instructionCount,
    nutritionAttached: result.recipe.nutritionAttached,
    recipeNote: result.recipe.reason,
  };
}

export async function recordExport(
  articleId: string,
  record: ExportRecord,
): Promise<void> {
  await prisma.article.update({
    where: { id: articleId },
    data: {
      wpDraftId: record.draftId,
      wpEditLink: record.editLink,
      wpSyncedAt: new Date(),
      wpExport: record as unknown as object,
    },
  });
}

export { TemplateNotFound };
