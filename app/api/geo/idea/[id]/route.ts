import { NextResponse } from "next/server";
import { z } from "zod";

import { AiError } from "@/lib/ai";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { parseAnchorPages, type AnchorPage } from "@/lib/geo/config";
import { cleanHtml, draftArticle } from "@/lib/geo/draft";
import type { BusinessFactsInput } from "@/lib/geo/generate";
import { faqToJson, serializeIdea } from "@/lib/geo/idea";
import { fetchExistingPosts, similarity } from "@/lib/geo/redundancy";
import { gatherSignals } from "@/lib/geo/signals";

/** Four sequential model calls plus a redundancy crawl. */
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    draftHtml: z.string().max(200_000).optional(),
    metaTitle: z.string().max(200).optional(),
    metaDescription: z.string().max(400).optional(),
    slug: z.string().max(200).optional(),
    faq: z
      .array(
        z.object({
          question: z.string().max(300),
          answer: z.string().max(2000),
        }),
      )
      .max(10)
      .optional(),
    status: z.enum(["idea", "drafting", "drafted"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

async function owned(id: string, userId: string) {
  if (!isValidId(id)) return null;
  return prisma.geoIdea.findFirst({ where: { id, userId } });
}

/** Saves editor changes. */
export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await owned(id, session.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body: unknown = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { draftHtml, faq, ...rest } = parsed.data;

  const updated = await prisma.geoIdea.update({
    where: { id },
    data: {
      ...rest,
      // Editor output is sanitised on the way in too, so a paste of styled
      // markup cannot end up in the WordPress export.
      ...(draftHtml !== undefined ? { draftHtml: cleanHtml(draftHtml) } : {}),
      ...(faq !== undefined ? { faq: faqToJson(faq) } : {}),
    },
  });

  return NextResponse.json({ ok: true, idea: serializeIdea(updated) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await owned(id, session.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.geoIdea.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

/** Runs the drafting pipeline for one selected moment. */
export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const idea = await owned(id, session.userId);
  if (!idea) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [project, factsRow] = await Promise.all([
    prisma.project.findFirst({
      where: { id: idea.projectId, userId: session.userId },
      select: { url: true },
    }),
    prisma.businessFacts.findUnique({ where: { projectId: idea.projectId } }),
  ]);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // The same hard gate as moment mapping — a draft with no grounding would
  // invent exactly the specifics this feature exists to avoid.
  if (!factsRow || factsRow.serviceArea.trim() === "") {
    return NextResponse.json(
      {
        error:
          "Fill in Business Facts first — at minimum the service area. Drafts are grounded in those facts, never invented.",
        needsFacts: true,
      },
      { status: 409 },
    );
  }

  const facts: BusinessFactsInput = {
    serviceArea: factsRow.serviceArea,
    travelPolicy: factsRow.travelPolicy,
    eventTypes: factsRow.eventTypes,
    guestMin: factsRow.guestMin,
    guestMax: factsRow.guestMax,
    dietaryHandling: factsRow.dietaryHandling,
    pricingLogic: factsRow.pricingLogic,
    leadTime: factsRow.leadTime,
    consultingScope: factsRow.consultingScope,
    pastEvents: factsRow.pastEvents,
    neverClaim: factsRow.neverClaim,
  };

  const anchorPages = parseAnchorPages(factsRow.anchorPages);
  const anchor: AnchorPage =
    anchorPages.find((a) => a.id === idea.anchorPageId) ?? anchorPages[0]!;

  try {
    const [signals, published] = await Promise.all([
      gatherSignals(idea.projectId, idea.seed),
      fetchExistingPosts(project.url).catch(() => []),
    ]);

    // Re-check redundancy at draft time, not just at mapping time: the blog
    // may have gained a post since the ideas were generated.
    const clash = published.find((p) => similarity(idea.title, p.title) >= 0.6);
    if (clash) {
      await prisma.geoIdea.update({
        where: { id },
        data: { redundantWith: `Already published: ${clash.title}` },
      });
      return NextResponse.json(
        {
          error: `This duplicates a published post: "${clash.title}". Drafting was stopped.`,
          redundant: true,
        },
        { status: 409 },
      );
    }

    await prisma.geoIdea.update({ where: { id }, data: { status: "drafting" } });

    const result = await draftArticle({
      title: idea.title,
      moment: idea.moment,
      category: idea.category,
      rationale: idea.rationale,
      attributes: idea.attributes,
      seed: idea.seed,
      anchor,
      anchorTextHint: idea.anchorText,
      facts,
      signals: signals.signals,
      // Never offer the article itself as a related link.
      related: published
        .filter((p) => similarity(idea.title, p.title) < 0.4)
        .slice(0, 5),
    });

    const saved = await prisma.geoIdea.update({
      where: { id },
      data: {
        status: "drafted",
        draftHtml: result.html,
        metaTitle: result.metaTitle,
        metaDescription: result.metaDescription,
        slug: result.slug,
        faq: faqToJson(result.faq),
        qaNotes: result.qaNotes,
      },
    });

    return NextResponse.json({ idea: serializeIdea(saved) });
  } catch (err) {
    console.error("[geo/idea]", err);
    await prisma.geoIdea
      .update({ where: { id }, data: { status: "idea" } })
      .catch(() => undefined);

    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.configurable ? 503 : 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not draft this article right now.",
      },
      { status: 502 },
    );
  }
}
