/**
 * How many SerpApi searches the plan has left.
 *
 * The account endpoint reports quota without spending a search, so this is
 * free to call — but it is still a network round trip, so the answer is held
 * briefly. Deep Dive's bulk analyse uses it to tell the author what a run will
 * actually cost before it starts, rather than after.
 */

type SerpAccount = {
  searches_per_month?: number;
  plan_searches_left?: number;
  total_searches_left?: number;
  error?: string;
};

export type SerpQuota = {
  /** Searches remaining this month. Null when SerpApi did not say. */
  left: number | null;
  /** Plan size, for context. Null when SerpApi did not say. */
  total: number | null;
};

const TTL_MS = 60_000;
let cached: { at: number; value: SerpQuota } | null = null;

export async function serpSearchesLeft(): Promise<SerpQuota> {
  const key = (process.env.SERPAPI_KEY ?? "").trim();
  if (key === "") return { left: null, total: null };

  if (cached !== null && Date.now() - cached.at < TTL_MS) return cached.value;

  try {
    const res = await fetch(
      `https://serpapi.com/account?api_key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return { left: null, total: null };

    const body = (await res.json()) as SerpAccount;
    if (body.error) return { left: null, total: null };

    const value: SerpQuota = {
      left: body.total_searches_left ?? body.plan_searches_left ?? null,
      total: body.searches_per_month ?? null,
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    // Unknown is not zero: a failed probe must not block a run the author
    // explicitly asked for.
    return { left: null, total: null };
  }
}
