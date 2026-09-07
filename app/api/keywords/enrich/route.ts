import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { enrichKeyword, MAX_ENRICH } from "@/lib/keywords/deep-dive";
import { ProviderError } from "@/lib/keywords/types";

/**
 * The measured columns for a handful of chosen keywords.
 *
 * Est. Links, DA and Ranking Pages all come from a real first page, which costs
 * one SERP call per keyword against a 250-a-month plan. So this is never run
 * for a whole result set — the author selects the rows worth spending on, and
 * the cap here is the backstop. Anything already in the 7-day SERP cache costs
 * nothing and comes back just the same.
 */

export const maxDuration = 60;

const schema = z.object({
  keywords: z.array(z.string().trim().min(1).max(120)).min(1).max(MAX_ENRICH),
  country: z.string().min(2).max(5).default("us"),
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
      {
        error:
          parsed.error.issues[0]?.code === "too_big"
            ? `Analyse at most ${String(MAX_ENRICH)} keywords at a time — each one spends a SERP lookup.`
            : (parsed.error.issues[0]?.message ?? "Invalid input"),
      },
      { status: 400 },
    );
  }

  const keywords = [...new Set(parsed.data.keywords.map((k) => k.toLowerCase()))];

  /*
   * Sequential, not parallel. Ten simultaneous SERP requests is the shape of
   * traffic that gets an API key rate-limited, and the whole point of this
   * endpoint is that it runs rarely and deliberately.
   *
   * Time-guarded: stop processing before the function timeout so the keywords
   * that DID finish are returned. The client sends the next batch automatically.
   */
  const deadline = Date.now() + 50_000;
  const results: Record<string, unknown> = {};

  for (const keyword of keywords) {
    if (Date.now() > deadline) break;
    try {
      results[keyword] = await enrichKeyword(keyword, parsed.data.country);
    } catch (err) {
      if (err instanceof ProviderError) {
        console.warn(`[deep-dive enrich] ${keyword}: ${err.message}`);
        results[keyword] = null;
      } else {
        console.error(`[deep-dive enrich] ${keyword}:`, err);
        results[keyword] = null;
      }
    }
  }

  return NextResponse.json({ results });
}
