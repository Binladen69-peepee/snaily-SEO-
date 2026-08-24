import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { buildForecast } from "@/lib/foresight/forecast";
import { defaultAssumptions, withOverrides } from "@/lib/foresight/scenario";
import { listForecasts, saveForecast } from "@/lib/foresight/store";
import { parseHorizon, parseScenario, type Assumptions } from "@/lib/foresight/types";

/** Reading a whole project's evidence and simulating takes a few seconds. */
export const maxDuration = 60;

/**
 * Every lever the client is allowed to move.
 *
 * Bounded rather than free-form. A conversion rate of 400% or a rank
 * achievement of 12 would produce a forecast that is arithmetically consistent
 * and completely detached from reality, and the resulting number would be
 * screenshotted long before anyone checked what was typed to produce it.
 */
const overridesSchema = z.object({
  horizon: z.union([z.string(), z.number()]).optional(),
  scenario: z.string().optional(),
  targetPosition: z.number().int().min(1).max(30).optional(),
  rankAchievement: z.number().min(0).max(1).optional(),
  ctrMultiplier: z.number().min(0.3).max(2).optional(),
  timeMultiplier: z.number().min(0.3).max(3).optional(),
  rampShare: z.number().min(0).max(1).optional(),
  conversionRate: z.number().min(0).max(1).nullable().optional(),
  revenuePerConversion: z.number().min(0).max(1_000_000).nullable().optional(),
  articlesPerMonth: z.number().int().min(0).max(60).optional(),
  optimisationsPerMonth: z.number().int().min(0).max(120).optional(),
  internalLinksPerMonth: z.number().int().min(0).max(500).optional(),
  keywords: z.array(z.string().max(200)).max(200).optional(),
});

async function ownedProject(projectId: string, userId: string) {
  if (!isValidId(projectId)) return null;
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, url: true, name: true },
  });
}

function assumptionsFrom(
  input: z.infer<typeof overridesSchema>,
): { assumptions: Assumptions; overrides: Partial<Assumptions> } {
  const scenario = parseScenario(input.scenario);
  const horizon = parseHorizon(input.horizon);
  const base = defaultAssumptions(scenario, horizon);

  const overrides: Partial<Assumptions> = {};
  if (input.rankAchievement !== undefined) overrides.rankAchievement = input.rankAchievement;
  if (input.ctrMultiplier !== undefined) overrides.ctrMultiplier = input.ctrMultiplier;
  if (input.timeMultiplier !== undefined) overrides.timeMultiplier = input.timeMultiplier;
  if (input.rampShare !== undefined) overrides.rampShare = input.rampShare;
  if (input.targetPosition !== undefined) overrides.defaultTargetPosition = input.targetPosition;
  if (input.conversionRate !== undefined) overrides.conversionRate = input.conversionRate;
  if (input.revenuePerConversion !== undefined) {
    overrides.revenuePerConversion = input.revenuePerConversion;
  }

  if (
    input.articlesPerMonth !== undefined ||
    input.optimisationsPerMonth !== undefined ||
    input.internalLinksPerMonth !== undefined
  ) {
    overrides.contentVelocity = {
      articlesPerMonth: input.articlesPerMonth ?? base.contentVelocity.articlesPerMonth,
      optimisationsPerMonth:
        input.optimisationsPerMonth ?? base.contentVelocity.optimisationsPerMonth,
      internalLinksPerMonth:
        input.internalLinksPerMonth ?? base.contentVelocity.internalLinksPerMonth,
    };
  }

  return { assumptions: withOverrides(base, overrides), overrides };
}

/** Builds a live forecast. Never writes anything. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";

  const project = await ownedProject(projectId, session.userId);
  if (project === null) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const num = (key: string): number | undefined => {
    const raw = url.searchParams.get(key);
    if (raw === null || raw.trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  const parsed = overridesSchema.safeParse({
    horizon: url.searchParams.get("horizon") ?? undefined,
    scenario: url.searchParams.get("scenario") ?? undefined,
    targetPosition: num("targetPosition"),
    rankAchievement: num("rankAchievement"),
    ctrMultiplier: num("ctrMultiplier"),
    timeMultiplier: num("timeMultiplier"),
    rampShare: num("rampShare"),
    conversionRate: num("conversionRate"),
    revenuePerConversion: num("revenuePerConversion"),
    articlesPerMonth: num("articlesPerMonth"),
    optimisationsPerMonth: num("optimisationsPerMonth"),
    internalLinksPerMonth: num("internalLinksPerMonth"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid forecast settings" },
      { status: 400 },
    );
  }

  const { assumptions, overrides } = assumptionsFrom(parsed.data);

  try {
    const forecast = await buildForecast({
      projectId: project.id,
      siteUrl: project.url,
      userId: session.userId,
      assumptions,
      overrides,
    });

    const saved = await listForecasts(session.userId, project.id);
    return NextResponse.json({ forecast, saved });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "foresight",
        event: "build_failed",
        projectId: project.id,
        reason: err instanceof Error ? err.message : "unknown",
      }),
    );
    return NextResponse.json(
      { error: "Could not build the forecast from this project's data." },
      { status: 500 },
    );
  }
}

const saveSchema = overridesSchema.extend({
  projectId: z.string().min(1),
  name: z.string().max(120).default(""),
});

/** Freezes the current forecast so it can be judged against reality later. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const project = await ownedProject(parsed.data.projectId, session.userId);
  if (project === null) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { assumptions, overrides } = assumptionsFrom(parsed.data);

  const forecast = await buildForecast({
    projectId: project.id,
    siteUrl: project.url,
    userId: session.userId,
    assumptions,
    overrides,
    selectedKeywords: parsed.data.keywords,
  });

  const id = await saveForecast({
    userId: session.userId,
    projectId: project.id,
    name:
      parsed.data.name.trim() === ""
        ? `${assumptions.scenario} · ${String(assumptions.horizonMonths)} months`
        : parsed.data.name,
    forecast,
  });

  return NextResponse.json({ id, saved: await listForecasts(session.userId, project.id) });
}
