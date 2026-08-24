import { after, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { kickRunner, selfOrigin } from "@/lib/jobs/kick";
import {
  createOrResumeJob,
  latestJobForArticle,
  loadStages,
  partialNote,
  toJobView,
} from "@/lib/jobs/store";
import { isTerminal, type StageName } from "@/lib/jobs/types";

export const maxDuration = 30;

/**
 * "Draft Article".
 *
 * Creates the job, wakes a worker, and answers. It deliberately does no
 * generation itself: the whole point is that the button returns in a few
 * hundred milliseconds and the article is written by invocations that outlive
 * this request.
 *
 * Safe to call twice. A live job for this article is returned as-is rather
 * than starting a second one, so a double click, an impatient refresh or a
 * retried POST all land on the same generation.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const article = await prisma.article.findFirst({
    where: { id, userId: session.userId },
    select: { id: true, projectId: true, mode: true, recipe: true, keyword: true },
  });

  if (article === null) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  if (article.mode !== "drafter") {
    return NextResponse.json(
      { error: "This article was not started as a Drafter recipe draft." },
      { status: 400 },
    );
  }

  if (article.recipe.trim() === "") {
    return NextResponse.json(
      { error: "Paste a recipe (ingredients and instructions) before drafting." },
      { status: 400 },
    );
  }

  const { job, created } = await createOrResumeJob({
    userId: session.userId,
    projectId: article.projectId,
    articleId: article.id,
  });

  const stages = await loadStages(job.id);
  const notes = new Map<StageName, string>(
    stages.map((s) => [s.name, partialNote(s.output)]),
  );

  const origin = selfOrigin(req);
  after(async () => {
    await kickRunner(job.id, origin);
  });

  return NextResponse.json(
    {
      job: toJobView(job, stages, (name) => notes.get(name) ?? ""),
      created,
    },
    { status: created ? 201 : 200 },
  );
}

/** The job the editor should show when it opens, if there is one. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const job = await latestJobForArticle(id, session.userId);
  if (job === null) return NextResponse.json({ job: null });

  const stages = await loadStages(job.id);
  const notes = new Map<StageName, string>(
    stages.map((s) => [s.name, partialNote(s.output)]),
  );

  return NextResponse.json({
    job: toJobView(job, stages, (name) => notes.get(name) ?? ""),
    live: !isTerminal(job.status),
  });
}
