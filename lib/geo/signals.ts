import { prisma } from "@/lib/db";
import { serpFetch } from "@/lib/keywords/providers/serpapi";

/**
 * Raw demand signal for a seed topic.
 *
 * Reuses the SerpApi and Search Console connections already wired up elsewhere
 * in the app — the spec is explicit about not building a second integration.
 *
 * Nothing here is invented: People Also Ask and related searches come straight
 * from the SERP payload, and the query list is what Google recorded for the
 * property. Signals the model later classifies are all traceable to one of
 * these sources.
 */

export type RawSignal = {
  phrase: string;
  /** Where it came from, so the UI can show provenance. */
  source: "paa" | "related" | "search-console";
  /** Impressions, for Search Console rows only. */
  impressions?: number;
  /** Average position, for Search Console rows only. */
  position?: number;
};

type SerpPayload = {
  error?: string;
  related_questions?: { question?: string }[];
  related_searches?: { query?: string }[];
};

/** People Also Ask and related searches for the seed. One cached SERP call. */
async function fromSerp(seed: string, country: string): Promise<RawSignal[]> {
  const apiKey = (process.env.SERPAPI_KEY ?? "").trim();
  if (apiKey === "") return [];

  let payload: SerpPayload;
  try {
    payload = await serpFetch<SerpPayload>(apiKey, "google", seed, country);
  } catch {
    // A missing SERP must not stop Search Console signal being used.
    return [];
  }

  const out: RawSignal[] = [];

  for (const q of payload.related_questions ?? []) {
    const phrase = q.question?.trim();
    if (phrase) out.push({ phrase, source: "paa" });
  }
  for (const r of payload.related_searches ?? []) {
    const phrase = r.query?.trim();
    if (phrase) out.push({ phrase, source: "related" });
  }

  return out;
}

/**
 * Queries already earning impressions near this topic.
 *
 * High impressions with few clicks is the interesting case — Google is already
 * showing the site for something it has not properly answered, which is exactly
 * what a supporting article is for.
 */
async function fromSearchConsole(
  projectId: string,
  seed: string,
): Promise<RawSignal[]> {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Match on the seed's distinctive words so the pull stays on topic.
  const words = seed
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const rows = await prisma.gscQueryMetric.groupBy({
    by: ["query"],
    where: {
      projectId,
      date: { gte: since },
      ...(words.length > 0
        ? { OR: words.map((w) => ({ query: { contains: w } })) }
        : {}),
    },
    _sum: { clicks: true, impressions: true },
    _avg: { position: true },
    orderBy: { _sum: { impressions: "desc" } },
    take: 60,
  });

  return rows
    .map((r) => ({
      phrase: r.query,
      source: "search-console" as const,
      impressions: r._sum.impressions ?? 0,
      clicks: r._sum.clicks ?? 0,
      position: Math.round((r._avg.position ?? 0) * 10) / 10,
    }))
    // Unmet intent first: seen a lot, clicked little.
    .sort((a, b) => {
      const gapA = a.impressions - a.clicks * 10;
      const gapB = b.impressions - b.clicks * 10;
      return gapB - gapA;
    })
    .map(({ phrase, source, impressions, position }) => ({
      phrase,
      source,
      impressions,
      position,
    }));
}

export type SignalBundle = {
  signals: RawSignal[];
  counts: { paa: number; related: number; searchConsole: number };
  /** True when neither source returned anything usable. */
  empty: boolean;
};

export async function gatherSignals(
  projectId: string,
  seed: string,
  country = "us",
): Promise<SignalBundle> {
  const [serp, gsc] = await Promise.all([
    fromSerp(seed, country),
    fromSearchConsole(projectId, seed).catch(() => [] as RawSignal[]),
  ]);

  // De-duplicate across sources, keeping the first (SERP) occurrence.
  const seen = new Set<string>();
  const signals: RawSignal[] = [];
  for (const s of [...serp, ...gsc]) {
    const key = s.phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push(s);
  }

  return {
    signals,
    counts: {
      paa: serp.filter((s) => s.source === "paa").length,
      related: serp.filter((s) => s.source === "related").length,
      searchConsole: gsc.length,
    },
    empty: signals.length === 0,
  };
}
