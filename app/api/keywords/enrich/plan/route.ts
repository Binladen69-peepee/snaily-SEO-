import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { dataForSeoConfigured } from "@/lib/dataforseo/config";
import { AUTO_ENRICH_CAP } from "@/lib/keywords/deep-dive-sources";
import { hasFreshSerpMany } from "@/lib/keywords/get-normalized-serp";
import { serpSearchesLeft } from "@/lib/keywords/quota";
import { ensureSettings } from "@/lib/settings";

/**
 * What a bulk analyse would cost, before spending anything.
 *
 * DataForSEO is the primary SERP provider, so SerpApi's monthly allowance
 * must not block ranking columns. Auto-enrich is capped so a 400-row Deep
 * Dive does not fire hundreds of live SERP calls.
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

  await ensureSettings();

  const keywords = [
    ...new Set(parsed.data.keywords.map((k) => k.toLowerCase())),
  ];
  const limited = keywords.slice(0, AUTO_ENRICH_CAP);
  const overflow = keywords.slice(AUTO_ENRICH_CAP);

  const [quota, cachedFlags] = await Promise.all([
    serpSearchesLeft(),
    hasFreshSerpMany(limited, parsed.data.country).catch(() =>
      limited.map(() => false),
    ),
  ]);

  const free = limited.filter((_k, i) => cachedFlags[i] === true);
  const unpaid = limited.filter((_k, i) => cachedFlags[i] !== true);

  /*
   * Only apply SerpApi's monthly cap when DataForSEO is not configured.
   * Otherwise ranking data would stay blank even though DFS can serve it.
   */
  const dfs = dataForSeoConfigured();
  const affordable =
    dfs || quota.left === null
      ? unpaid.length
      : Math.min(unpaid.length, Math.max(0, quota.left));

  const paid = unpaid.slice(0, affordable);
  const quotaSkipped = unpaid.slice(affordable);
  const skipped = [...quotaSkipped, ...overflow];

  return NextResponse.json({
    free,
    paid,
    skipped,
    counts: {
      total: keywords.length,
      free: free.length,
      paid: paid.length,
      skipped: skipped.length,
    },
    quota: dfs ? { left: null, total: null } : quota,
  });
}
