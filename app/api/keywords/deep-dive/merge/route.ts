import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { mergeDeepDive, type SourcePhrases } from "@/lib/keywords/deep-dive";
import { isSource, SOURCES } from "@/lib/keywords/suggest-sources";

/**
 * Merge phrase lists from multiple sources into scored, deduplicated rows.
 *
 * Pure CPU — no external calls — so it finishes in milliseconds.
 */
export const maxDuration = 10;

const schema = z.object({
  keyword: z.string().trim().min(1).max(120),
  country: z.string().min(2).max(5).default("us"),
  sourcePhrases: z.array(
    z.object({
      source: z.string(),
      phrases: z.array(z.string()),
      isMock: z.boolean().default(false),
    }),
  ),
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

  const validPhrases: SourcePhrases[] = parsed.data.sourcePhrases
    .filter((sp) => isSource(sp.source))
    .map((sp) => ({
      source: sp.source as SourcePhrases["source"],
      phrases: sp.phrases,
      isMock: sp.isMock,
    }));

  const result = mergeDeepDive({
    keyword: parsed.data.keyword,
    country: parsed.data.country,
    sourcePhrases: validPhrases,
    filters: parsed.data.filters,
  });

  return NextResponse.json(result);
}
