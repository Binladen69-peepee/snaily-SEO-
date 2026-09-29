import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { parseEditorial } from "@/lib/drafter/editorial";
import { sanitizeEditorHtml } from "@/lib/drafter/sanitize";
import { stripPlaceholders } from "@/lib/drafter/post-template";
import { getGoogleClient } from "@/lib/google/account";
import { DriveError, saveGoogleDoc } from "@/lib/google/drive";
import { originOf } from "@/lib/google/oauth";
import { toEditorHtml } from "@/lib/markdown";
import {
  isConnectivityFailure,
  isIndeterminate,
  WordPressError,
} from "@/lib/wordpress/client";
import {
  buildExport,
  PublishRefused,
  recordExport,
  sendExport,
  TemplateNotFound,
  toExportRecord,
  type ExportPlan,
} from "@/lib/wordpress/draft-export";
import { clearConnectionError, recordConnectionError } from "@/lib/wordpress/health";
import { getCredentials } from "@/lib/wordpress/sync";
import { isOutdatedPlugin } from "@/lib/wordpress/unavailable";
import { wordpressHealthFromRow } from "@/lib/setup/state";

export const maxDuration = 60;

const schema = z.object({
  dest: z.enum(["drive", "wordpress"]),
  folderId: z.string().max(200).optional(),
  /**
   * Accepted and ignored.
   *
   * The browser used to decide here whether an export updated the existing
   * draft or made a new one, from React state seeded at page load. It is the
   * article row that knows, so the server reads it there now. The field stays
   * in the schema only so a browser still running the old bundle gets its
   * export rather than a 400.
   */
  update: z.boolean().optional(),
});

/**
 * How long a claim on an article's export is honoured.
 *
 * Just past this route's own `maxDuration`: once the invocation holding a
 * claim can no longer be running, the claim is stale and the next export takes
 * it over. Shorter and a slow export could be duplicated by the retry it was
 * meant to block; longer and a killed invocation would lock the author out.
 */
const EXPORT_CLAIM_MS = 75_000;

/**
 * Claims the right to export this article, or reports who has it.
 *
 * The one thing a duplicate-draft bug needs is two exports of one article in
 * flight at once — a double-clicked button, a browser that retried the POST,
 * two open tabs. None of them can be undone by noticing afterwards, so they are
 * refused at the door instead. A conditional update is the whole mechanism: the
 * database decides which caller wins, and exactly one row is changed.
 */
async function claimExport(articleId: string): Promise<boolean> {
  const stale = new Date(Date.now() - EXPORT_CLAIM_MS);
  try {
    const claimed = await prisma.article.updateMany({
      where: {
        id: articleId,
        OR: [{ wpExportingAt: null }, { wpExportingAt: { lt: stale } }],
      },
      data: { wpExportingAt: new Date() },
    });
    return claimed.count === 1;
  } catch (err) {
    /*
     * The column is added by a schema push, and a deploy can land before one.
     *
     * In that window the claim cannot be taken, and refusing every export
     * would be a worse bug than the one this guards against — especially as
     * the three other layers still hold: the planner targets the draft the
     * article already has, the connector recognises a repeat of an export it
     * has carried out, and a timed-out write is never re-sent. So the export
     * proceeds, loudly, and the mutex starts working the moment the column
     * exists.
     */
    console.error("[wordpress export] could not claim the article", err);
    return true;
  }
}

async function releaseExport(articleId: string): Promise<void> {
  // Never allowed to fail the export it is cleaning up after: the draft is
  // already on the site, and a stale claim expires by itself.
  try {
    await prisma.article.update({
      where: { id: articleId },
      data: { wpExportingAt: null },
    });
  } catch {
    /* Expires on its own. */
  }
}

type Params = { params: Promise<{ id: string }> };

const ARTICLE_FIELDS = {
  id: true,
  title: true,
  content: true,
  editorial: true,
  recipeCard: true,
  driveFileId: true,
  wpDraftId: true,
  projectId: true,
  // Yoast's focus keyphrase is the keyword the article was written for.
  keyword: true,
  project: { select: { driveFolderId: true } },
} as const;

async function loadArticle(id: string, userId: string) {
  if (!isValidId(id)) return null;
  return prisma.article.findFirst({
    where: { id, userId },
    select: ARTICLE_FIELDS,
  });
}

/** WordPress readiness, as the gate dialog understands it. */
async function wordpressGate(projectId: string) {
  const row = await prisma.wordPressConnection.findUnique({
    where: { projectId },
    select: { lastError: true },
  });
  const health = wordpressHealthFromRow(row);
  if (health !== "connected") return { ok: false as const, reason: health };

  const creds = await getCredentials(projectId);
  if (!creds) return { ok: false as const, reason: "connection_lost" };

  return { ok: true as const, creds };
}

/** The shape the export preview and the result panel both read. */
function planSummary(plan: ExportPlan) {
  return {
    template: plan.template,
    sections: plan.mapping.sections,
    steps: {
      mapped: plan.mapping.stepsMapped,
      slots: plan.mapping.stepSlotsInTemplate,
      added: plan.mapping.stepColumnsAdded,
      removed: plan.mapping.stepColumnsRemoved,
    },
    faqs: plan.mapping.faqsMapped,
    internalLinks: plan.links.internalResolved,
    unresolvedInternal: plan.links.internalUnresolved,
    affiliateLinks: plan.links.affiliateLinked.map((l) => ({
      term: l.term,
      kind: l.kind,
      // The affiliate URL carries the author's tracking credentials, so the
      // browser is told the host it points at and nothing more.
      host: hostOf(l.url),
    })),
    relatedPosts: plan.links.relatedIds,
    imagesSkipped: plan.mapping.localImagesSkipped,
    recipeCardPreserved: plan.mapping.recipeCardPreserved,
    unmapped: plan.mapping.unmapped,
    unknownTemplateHeadings: plan.mapping.unknownTemplateHeadings,
    needsReview: plan.mapping.needsReview,
    updating: plan.targetPostId !== null,
    focusKeyword: plan.payload.focusKeyword ?? "",
    robots: plan.payload.robots ?? null,
    /*
     * The card that would be created, described rather than repeated: the
     * author needs to see that their fifteen ingredients are going across
     * untouched, not read them again in a preview.
     */
    recipeCard:
      plan.recipe === null
        ? null
        : {
            name: plan.recipe.name,
            ingredients: plan.recipe.ingredients.length,
            instructions: plan.recipe.instructions.length,
            servings: plan.recipe.servings,
            servingsUnit: plan.recipe.servings_unit,
            prepTime: plan.recipe.prep_time,
            cookTime: plan.recipe.cook_time,
            course: plan.recipe.course,
            cuisine: plan.recipe.cuisine,
            diet: plan.recipe.suitablefordiet,
            equipment: plan.recipe.equipment.length,
          },
    seo: {
      title: plan.meta.seoTitle,
      description: plan.meta.seoDescription,
      slug: plan.meta.slug,
      excerpt: plan.meta.excerpt,
      categories: plan.payload.categories ?? [],
      tags: plan.payload.tags ?? [],
    },
    status: "draft" as const,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** One place to turn a WordPress failure into the reason the UI branches on. */
async function wordpressError(projectId: string, err: unknown) {
  console.error("[wordpress export]", err);

  if (err instanceof TemplateNotFound) {
    return NextResponse.json(
      { reason: "template_missing", error: err.message },
      { status: 409 },
    );
  }

  if (err instanceof PublishRefused) {
    // Never reachable through the UI; if it ever is, it is a bug worth seeing.
    return NextResponse.json(
      { reason: "publish_refused", error: err.message },
      { status: 400 },
    );
  }

  /*
   * A write that got no answer is its own outcome, not a failed export.
   *
   * It must not be reported as "could not create a draft", because it may well
   * have created one, and an author told it failed clicks Export again. The
   * article keeps no draft ID from this, so the next export reconciles through
   * the connector's own article binding rather than stacking a second post.
   */
  if (isIndeterminate(err)) {
    return NextResponse.json(
      { reason: "indeterminate", error: (err as WordPressError).message },
      { status: 504 },
    );
  }

  const lost = isConnectivityFailure(err);
  if (lost) await recordConnectionError(projectId, err);

  const outdated =
    !lost &&
    err instanceof WordPressError &&
    (err.kind === "route_missing" || isOutdatedPlugin(err.message));

  return NextResponse.json(
    {
      setupIncomplete: lost,
      reason: outdated ? "route_missing" : lost ? "connection_lost" : "export_failed",
      error: lost
        ? "WordPress setup is incomplete"
        : err instanceof WordPressError
          ? err.message
          : "Could not create a WordPress draft.",
    },
    { status: lost || outdated ? 409 : 502 },
  );
}

/**
 * The WordPress export preview.
 *
 * Runs the whole mapping without touching the site, so the checklist the
 * author confirms is the same computation the export performs rather than a
 * description of it.
 */
export async function GET(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const article = await loadArticle(id, session.userId);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  if (article.content.trim() === "") {
    return NextResponse.json(
      { error: "Write something before exporting." },
      { status: 400 },
    );
  }

  const gate = await wordpressGate(article.projectId);
  if (!gate.ok) {
    return NextResponse.json(
      {
        setupIncomplete: true,
        reason: gate.reason,
        error: "WordPress setup is incomplete",
      },
      { status: 409 },
    );
  }

  try {
    /*
     * No options: the preview has to be the export. It was previously steered
     * by an `update=1` query parameter the browser set from its own state,
     * which meant the checklist an author confirmed could describe a different
     * write from the one that followed.
     */
    const plan = await buildExport(article);
    return NextResponse.json(planSummary(plan));
  } catch (err) {
    return wordpressError(article.projectId, err);
  }
}

export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const article = await loadArticle(id, session.userId);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  if (article.content.trim() === "") {
    return NextResponse.json(
      { error: "Write something before exporting." },
      { status: 400 },
    );
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  if (parsed.data.dest === "wordpress") {
    const gate = await wordpressGate(article.projectId);
    if (!gate.ok) {
      return NextResponse.json(
        {
          setupIncomplete: true,
          reason: gate.reason,
          error: "WordPress setup is incomplete",
        },
        { status: 409 },
      );
    }

    if (!(await claimExport(article.id))) {
      /*
       * Another export of this article is already on its way to WordPress.
       * Refusing is the only safe answer: there is no way to join the one in
       * flight, and going ahead anyway is precisely how two drafts appear.
       */
      return NextResponse.json(
        {
          reason: "export_in_progress",
          error:
            "This article is already being exported. Give it a moment, then check your WordPress drafts.",
        },
        { status: 409 },
      );
    }

    try {
      /*
       * No caller-supplied target. `buildExport` reads the article's own
       * `wpDraftId`, so an article that has been exported before goes back into
       * the draft it already has, whatever the browser believes.
       */
      const plan = await buildExport(article);
      const result = await sendExport(gate.creds, plan);

      if (result.id <= 0) {
        // A response with no post ID is not a draft. Reporting success here
        // would leave the author believing their work is on the site.
        throw new WordPressError(
          "WordPress accepted the request but returned no draft ID. Nothing was created.",
        );
      }

      const record = toExportRecord(result);
      await recordExport(article.id, record);
      await clearConnectionError(article.projectId);

      return NextResponse.json({
        dest: "wordpress",
        id: result.id,
        url: result.editLink,
        updated: result.updated,
        deduped: result.deduped,
        record,
        ...planSummary(plan),
      });
    } catch (err) {
      return wordpressError(article.projectId, err);
    } finally {
      await releaseExport(article.id);
    }
  }

  /* ---- Google Drive ------------------------------------------------- */

  const html = stripPlaceholders(sanitizeEditorHtml(toEditorHtml(article.content)));
  void parseEditorial(article.editorial);

  const origin = originOf(req);
  let client;
  try {
    client = await getGoogleClient(session.userId, origin);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Google access expired. Sign in with Google again.",
        needsAuth: true,
      },
      { status: 401 },
    );
  }

  if (!client) {
    return NextResponse.json(
      { error: "Connect Google first, then save to Drive.", needsAuth: true },
      { status: 401 },
    );
  }

  const folderId = (parsed.data.folderId ?? article.project.driveFolderId).trim();

  try {
    const saved = await saveGoogleDoc(client, {
      title: article.title,
      html,
      folderId,
      fileId: article.driveFileId || undefined,
    });

    await prisma.article.update({
      where: { id: article.id },
      data: { driveFileId: saved.id, driveFileUrl: saved.url },
    });

    if (saved.folderId !== article.project.driveFolderId) {
      await prisma.project.update({
        where: { id: article.projectId },
        data: { driveFolderId: saved.folderId },
      });
    }

    return NextResponse.json({ dest: "drive", id: saved.id, url: saved.url });
  } catch (err) {
    // The WordPress branch has logged its failures from the start; this one
    // swallowed them, so a Drive outage read as "Export failed" and nothing else.
    console.error("[drive export]", err);

    if (err instanceof DriveError) {
      return NextResponse.json(
        { error: err.message, needsAuth: err.needsAuth },
        { status: err.needsAuth ? 401 : 502 },
      );
    }
    return NextResponse.json(
      { error: "Could not save to Google Drive." },
      { status: 502 },
    );
  }
}
