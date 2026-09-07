import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { fetchSourcePhrases } from "@/lib/keywords/deep-dive";
import { isSource } from "@/lib/keywords/suggest-sources";
import { ProviderError } from "@/lib/keywords/types";

/**
 * Single-source phrase fetch for Deep Dive.
 *
 * The client calls this once per selected source, in parallel. Each call
 * finishes well under 10 s (the Vercel Hobby function limit), whereas the
 * old all-in-one endpoint needed 30–60 s for eight expanded sources.
 */
export const maxDuration = 10;

const schema = z.object({
  keyword: z.string().trim().min(1).max(120),
  country: z.string().min(2).max(5).default("us"),
  source: z.string().min(1),
  expand: z.boolean().default(false),
});

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

  if (!isSource(parsed.data.source)) {
    return NextResponse.json(
      { error: "Unknown source." },
      { status: 400 },
    );
  }

  try {
    const result = await fetchSourcePhrases(
      parsed.data.keyword,
      parsed.data.country,
      parsed.data.source,
      parsed.data.expand,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[deep-dive/source]", err);
    return NextResponse.json(
      { error: "Source fetch failed." },
      { status: 502 },
    );
  }
}
