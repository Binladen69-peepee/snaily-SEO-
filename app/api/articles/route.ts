import { after, NextResponse } from "next/server";
import { z } from "zod";

import { markdownWords, type ArticleStatus } from "@/lib/articles";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { kickRunner, selfOrigin } from "@/lib/jobs/kick";
import { staleJobs } from "@/lib/jobs/store";

export const maxDuration = 60;

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  keyword: z.string().trim().min(1).max(200),
  country: z.string().min(2).max(5).default("us"),
  mode: z.enum(["optimize", "drafter"]).default("optimize"),
  recipe: z.string().trim().max(50_000).optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /*
   * Restart any of this user's generations whose worker died.
   *
   * The chain and the open editor's poll cover everything that is still
   * running or still being watched. This covers the rest, and it is here
   * rather than only in cron because this deployment is on a plan where cron
   * runs once a day - so "closed the laptop mid-draft" would otherwise mean
   * waiting until morning. Opening the article list is the next thing that
   * person does, and one indexed query on the way past is a fair price.
   *
   * Scoped to their own jobs, and after the response, so it costs the page
   * nothing.
   */
  const origin = selfOrigin(req);
  after(async () => {
    for (const id of await staleJobs(3, session.userId)) {
      await kickRunner(id, origin);
    }
  });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");

  const articles = await prisma.article.findMany({
    where: {
      userId: session.userId,
      ...(projectId !== null && isValidId(projectId) ? { projectId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      keyword: true,
      status: true,
      content: true,
      mode: true,
      phase: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      keyword: a.keyword,
      status: a.status as ArticleStatus,
      updatedAt: a.updatedAt.toISOString(),
      words: markdownWords(a.content),
      mode: a.mode,
      phase: a.phase,
    })),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { projectId, title, keyword, country, mode, recipe } = parsed.data;

  if (!isValidId(projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.userId },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (mode === "drafter" && (recipe ?? "").trim() === "") {
    return NextResponse.json(
      { error: "Paste the recipe (ingredients and instructions) to start a draft." },
      { status: 400 },
    );
  }

  /*
   * A new article starts empty, in both modes.
   *
   * Drafter posts used to be seeded with the section skeleton so the author
   * did not rebuild it by hand. That was the bug behind "the Drafter produces
   * placeholder text": the article opened already full of prompts — "Hook,
   * three or four sentences", "What happens in this step" — which reads as a
   * finished draft whose every paragraph is an instruction. Nothing
   * downstream could tell that apart from prose.
   *
   * The skeleton's real job is export mapping, and that is where it now lives:
   * the WordPress template is resolved at export time and the generated prose
   * is placed into its sections. What the author sees in the editor is what
   * the model actually wrote.
   */
  const content = "";

  const article = await prisma.article.create({
    data: {
      userId: session.userId,
      projectId,
      title,
      keyword: keyword.toLowerCase(),
      country,
      status: "preparing",
      mode,
      phase: mode === "drafter" ? "outline" : "",
      recipe: mode === "drafter" ? (recipe ?? "").trim() : "",
      content,
    },
    select: { id: true },
  });

  // Research is *not* kicked off here. Detached work does not survive a
  // serverless function — the response ends the invocation — so the editor
  // calls /prepare and waits for it inside a live request instead.
  return NextResponse.json({ id: article.id }, { status: 201 });
}
