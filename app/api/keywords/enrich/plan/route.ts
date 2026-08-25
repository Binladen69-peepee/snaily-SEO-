import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { hasFreshSerp } from "@/lib/keywords/get-normalized-serp";
import { serpSearchesLeft } from "@/lib/keywords/quota";

/**
 * What a bulk analyse would cost, before spending anything.
 *
 * Splits the requested keywords into the ones already in the seven-day SERP
 * cache — free — and the ones that need a fresh lookup, then reports the plan's
 * remaining allowance alongside. The confirmation dialog is built from this, so
 * the number the author agrees to is the number that will actually be spent
 * rather than a guess based on row count.
 */

export const maxDuration = 30;

const schema = z.object({
  keywords: z.array(z.string().trim().min(1).max(120)).min(1).max(500),
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
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const keywords = [...new Set(parsed.data.keywords.map((k) => k.toLowerCase()))];

  const [quota, cachedFlags] = await Promise.all([
    serpSearchesLeft(),
    Promise.all(
      keywords.map((k) =>
        hasFreshSerp(k, parsed.data.country).catch(() => false),
      ),
    ),
  ]);

  const free = keywords.filter((_k, i) => cachedFlags[i] === true);
  const paid = keywords.filter((_k, i) => cachedFlags[i] !== true);

  /*
   * The run is capped at what the plan can actually cover. Free rows are not
   * counted against it, so a list that is mostly cached stays runnable even on
   * a nearly-spent allowance.
   */
  const affordable =
    quota.left === null ? paid.length : Math.min(paid.length, quota.left);

  return NextResponse.json({
    free: free.map((k) => k),
    paid: paid.slice(0, affordable),
    skipped: paid.slice(affordable),
    counts: {
      total: keywords.length,
      free: free.length,
      paid: affordable,
      skipped: paid.length - affordable,
    },
    quota,
  });
}
