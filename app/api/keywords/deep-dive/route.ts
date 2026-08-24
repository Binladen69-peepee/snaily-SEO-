import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { runDeepDive } from "@/lib/keywords/deep-dive";
import { isSource, SOURCES } from "@/lib/keywords/suggest-sources";
import { ProviderError } from "@/lib/keywords/types";

/**
 * Deep Dive search.
 *
 * A POST rather than a GET because the a–z expansion fans out to dozens of
 * upstream calls and can take a few seconds — long enough that it wants to be
 * an explicit action with a spinner, not something a shared URL re-runs.
 */

export const maxDuration = 60;

const schema = z.object({
  keyword: z.string().trim().min(1).max(120),
  country: z.string().min(2).max(5).default("us"),
  sources: z.array(z.string()).min(1).max(8),
  expand: z.boolean().default(false),
  filters: z
    .object({
      volumeMin: z.number().optional(),
      volumeMax: z.number().optional(),
      difficultyMin: z.number().optional(),
      difficultyMax: z.number().optional(),
      cpcMin: z.number().optional(),
      cpcMax: z.number().optional(),
      wordsMin: z.number().optional(),
      wordsMax: z.number().optional(),
      contains: z.string().max(200).optional(),
      excludes: z.string().max(200).optional(),
    })
    .default({}),
});

export function GET() {
  // The picker needs the catalogue before any search has run.
  return NextResponse.json({ sources: SOURCES });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const sources = parsed.data.sources.filter(isSource);
  if (sources.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one source that is connected." },
      { status: 400 },
    );
  }

  try {
    const result = await runDeepDive({
      keyword: parsed.data.keyword,
      country: parsed.data.country,
      sources,
      expand: parsed.data.expand,
      filters: parsed.data.filters,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[deep-dive]", err);
    return NextResponse.json(
      { error: "Could not run that search right now." },
      { status: 502 },
    );
  }
}
