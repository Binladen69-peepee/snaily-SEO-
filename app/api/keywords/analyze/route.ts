import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import {
  MAX_BULK_KEYWORDS,
  opportunityScore,
  parseKeywordInput,
} from "@/lib/keywords/opportunity";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { ProviderError } from "@/lib/keywords/types";

/*
 * A bulk run is one live SERP lookup per keyword. The default slice is far
 * too short for that, and overrunning it returns an HTML gateway page rather
 * than JSON — which is what left the Analyze button spinning forever.
 */
export const maxDuration = 60;

const schema = z.object({
  keywords: z.string().min(1, "Enter at least one keyword").max(50_000),
  country: z.string().length(2).default("us"),
  language: z.string().min(2).max(5).default("en"),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const keywords = parseKeywordInput(parsed.data.keywords);

  if (keywords.length === 0) {
    return NextResponse.json(
      { error: "No valid keywords found" },
      { status: 400 },
    );
  }

  if (keywords.length > MAX_BULK_KEYWORDS) {
    return NextResponse.json(
      {
        error: `Too many keywords. The limit is ${String(MAX_BULK_KEYWORDS)} per analysis — you submitted ${String(keywords.length)}.`,
      },
      { status: 400 },
    );
  }

  const provider = getKeywordProvider();

  try {
    const results = await provider.analyze(
      keywords,
      parsed.data.country,
      parsed.data.language,
    );

    return NextResponse.json({
      results: results.map((k) => ({ ...k, opportunity: opportunityScore(k) })),
      provider: provider.name,
    });
  } catch (err) {
    const message =
      err instanceof ProviderError
        ? err.message
        : "Could not analyze these keywords. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
