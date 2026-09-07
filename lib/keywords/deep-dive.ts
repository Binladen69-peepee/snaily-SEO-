import { estimateKeyword } from "@/lib/keywords/estimate";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { hasFreshSerp } from "@/lib/keywords/get-normalized-serp";
import { crawlGraphConfigured } from "@/lib/metrics/link-data";
import {
  countTabs,
  filterByTab,
  type DeepDiveTab,
  type TabCounts,
} from "@/lib/keywords/intent-tabs";
import {
  expandSuggestions,
  fetchSuggestions,
  SOURCE_BY_ID,
  type DeepDiveSource,
} from "@/lib/keywords/suggest-sources";
import { matchesTerms, type Keyword, type KeywordFilters } from "@/lib/keywords/types";

/**
 * Deep Dive: one keyword in, a few hundred ranked ideas out.
 *
 * The split of what is measured and what is estimated is the same as everywhere
 * else in the app, and the screen says so:
 *
 *   - The **phrases** are real. Every one came back from an autocomplete
 *     endpoint or from Google's own related searches, which is to say a real
 *     person typing this saw it offered.
 *   - **The order** is real too: rows are sorted by how prominently the engines
 *     offered each phrase, which is the closest thing here to observed demand.
 *   - **Volume, CPC, PPC and Score** are *modelled*, not estimated from search
 *     data. The only real input is word count; the rest is a deterministic hash
 *     of the phrase. Checked against Google's own autocomplete ordering, volume
 *     scores a Spearman rho of -0.47 — so it must never decide row order, and
 *     the screen says plainly that it is not measured.
 *   - **Ranking Pages** is measured — Google's results, in Google's order — but
 *     only for rows the author asks to analyse, because each costs a SERP call
 *     against a 250-a-month plan. **Est. Links and DA³** come from that same
 *     call but are themselves modelled, since no backlink index is connected.
 */

export type DeepDiveRow = Keyword & {
  /** Which of the selected sources offered this phrase. */
  sources: DeepDiveSource[];
  /** Populated only once a SERP has been fetched for this keyword. */
  serp: SerpSnapshot | null;
};

export type SerpSnapshot = {
  /** Median referring domains across the top 10 — links needed to compete. */
  estLinks: number | null;
  /** Mean Domain Authority of the top 3 results. */
  da3: number | null;
  /** The first ten results, for the favicon strip. */
  pages: { domain: string; favicon: string; authority: number | null }[];
  /** Difficulty read off the real SERP, which beats the volume estimate. */
  difficulty: number | null;
  fetchedAt: string;
};

export type DeepDiveResult = {
  keyword: string;
  country: string;
  source: DeepDiveSource;
  rows: DeepDiveRow[];
  counts: TabCounts;
  /** Sources that returned nothing, so the UI can say which and why. */
  emptySources: string[];
  /** True when the phrases are generated rather than fetched. */
  isMock: boolean;
};

export type DeepDiveParams = {
  keyword: string;
  country: string;
  sources: DeepDiveSource[];
  /** Widen one autocomplete call into an a–z sweep. */
  expand: boolean;
  filters: KeywordFilters;
};

/** Race a promise against a millisecond timer; returns null on timeout. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Max time a single provider.detail() call may take (seconds). */
const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * Phrases from one source, however that source happens to work.
 *
 * @param deadline — epoch ms after which expansion stops. Avoids Vercel
 *   function timeout when "Deep sweep" fans out to hundreds of requests.
 */
async function phrasesFrom(
  source: DeepDiveSource,
  keyword: string,
  country: string,
  expand: boolean,
  deadline?: number,
): Promise<string[]> {
  if (source === "related") {
    const provider = getKeywordProvider();
    const detail = await withTimeout(
      provider.detail(keyword, country, "en"),
      PROVIDER_TIMEOUT_MS,
    );
    if (!detail) return [];
    return [
      ...detail.related.map((k) => k.keyword),
      ...detail.questions.map((k) => k.keyword),
    ];
  }

  if (source === "competitors") {
    const provider = getKeywordProvider();
    const detail = await withTimeout(
      provider.detail(keyword, country, "en"),
      PROVIDER_TIMEOUT_MS,
    );
    if (!detail) return [];
    return detail.serp
      .flatMap((r) => [r.title, r.displayedLink])
      .map((t) => t.toLowerCase())
      .flatMap((title) =>
        title
          .split(/[|\-–—:•·»>]+/)
          .map((part) => part.trim())
          .filter((part) => {
            const words = part.split(/\s+/).length;
            return words >= 2 && words <= 8 && part.length <= 70;
          }),
      );
  }

  return expand
    ? expandSuggestions(source, keyword, country, undefined, deadline)
    : fetchSuggestions(source, keyword, country);
}

function passesFilters(k: Keyword, f: KeywordFilters): boolean {
  const words = k.keyword.split(/\s+/).length;
  if (f.volumeMin !== undefined && k.volume < f.volumeMin) return false;
  if (f.volumeMax !== undefined && k.volume > f.volumeMax) return false;
  if (f.difficultyMin !== undefined && k.difficulty < f.difficultyMin) return false;
  if (f.difficultyMax !== undefined && k.difficulty > f.difficultyMax) return false;
  if (f.cpcMin !== undefined && k.cpc < f.cpcMin) return false;
  if (f.cpcMax !== undefined && k.cpc > f.cpcMax) return false;
  if (f.wordsMin !== undefined && words < f.wordsMin) return false;
  if (f.wordsMax !== undefined && words > f.wordsMax) return false;
  if (f.intent !== undefined && k.intent !== f.intent) return false;
  if (f.contains && !matchesTerms(k.keyword, f.contains)) return false;
  if (f.excludes && matchesTerms(k.keyword, f.excludes)) return false;
  return true;
}

/** Junk that autocomplete returns and nobody wants in a keyword list. */
function isUsable(phrase: string, seed: string): boolean {
  if (phrase.length < 3 || phrase.length > 120) return false;
  // Amazon and eBay return bare brand fragments and stray punctuation.
  if (!/[a-z]/i.test(phrase)) return false;
  if (/^https?:/i.test(phrase)) return false;
  // Autocomplete pads with the alphabet letter used to expand the search.
  if (new RegExp(`^${seed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} [a-z]$`).test(phrase)) {
    return false;
  }
  return true;
}

export async function runDeepDive(params: DeepDiveParams): Promise<DeepDiveResult> {
  const keyword = params.keyword.trim().toLowerCase();
  const provider = getKeywordProvider();

  if (keyword === "") {
    return {
      keyword,
      country: params.country,
      source: params.sources[0] ?? "google",
      rows: [],
      counts: countTabs([]),
      emptySources: [],
      isMock: provider.isMock,
    };
  }

  const wanted = params.sources.filter((s) => SOURCE_BY_ID.get(s)?.available === true);
  const sources = wanted.length > 0 ? wanted : (["google"] as DeepDiveSource[]);

  /*
   * Hard deadline: 40 s of useful work. Expansion batches stop after this,
   * and provider.detail() calls have their own 15 s cap. This keeps the
   * total well under Vercel's 60 s function limit.
   */
  const deadline = Date.now() + 40_000;

  // All sources run in parallel; each one is individually time-bounded.
  const settled = await Promise.allSettled(
    sources.map(async (source) => ({
      source,
      phrases: await phrasesFrom(source, keyword, params.country, params.expand, deadline),
    })),
  );

  /** Phrase → the sources that offered it, so a row can show its provenance. */
  const bySource = new Map<string, Set<DeepDiveSource>>();
  /**
   * Phrase → the best position any source gave it.
   *
   * Autocomplete is returned roughly most-searched-first, which makes this the
   * only signal in the whole row that reflects real demand. Sorting by the
   * estimated volume instead threw it away: that figure is derived from a hash
   * of the phrase plus its word count, and measured against Google's own
   * ordering it comes out at a Spearman rho of -0.47 — worse than not sorting.
   */
  const bestRank = new Map<string, number>();
  const emptySources: string[] = [];

  for (const outcome of settled) {
    if (outcome.status !== "fulfilled") continue;
    const { source, phrases } = outcome.value;

    const usable = phrases
      .map((p) => p.trim().toLowerCase())
      .filter((p) => isUsable(p, keyword));

    if (usable.length === 0) {
      emptySources.push(SOURCE_BY_ID.get(source)?.label ?? source);
      continue;
    }

    usable.forEach((phrase, rank) => {
      const set = bySource.get(phrase) ?? new Set<DeepDiveSource>();
      set.add(source);
      bySource.set(phrase, set);
      bestRank.set(phrase, Math.min(bestRank.get(phrase) ?? rank, rank));
    });
  }

  for (const outcome of settled) {
    if (outcome.status === "rejected") emptySources.push("a source that failed");
  }

  // The seed itself belongs in the list — it is what was searched for.
  if (!bySource.has(keyword)) bySource.set(keyword, new Set(sources));

  const rows: DeepDiveRow[] = [...bySource.entries()]
    .map(([phrase, set]) => ({
      ...estimateKeyword(phrase, params.country),
      sources: [...set],
      serp: null,
    }))
    .filter((row) => passesFilters(row, params.filters))
    /*
     * Ordered by how prominently the engines themselves offered the phrase,
     * then by how many engines agreed. Both are observations; the estimated
     * volume is not, so it does not decide what the author reads first.
     */
    .sort(
      (a, b) =>
        (bestRank.get(a.keyword) ?? 999) - (bestRank.get(b.keyword) ?? 999) ||
        b.sources.length - a.sources.length ||
        a.keyword.localeCompare(b.keyword),
    );

  /*
   * Fill the measured columns for every row we can do for free.
   *
   * Est. Links, DA and Ranking Pages come off a real results page, and a fresh
   * lookup costs one of 250 searches a month — which is why they are not
   * fetched for the whole list. But a keyword whose page is already in the
   * seven-day cache costs nothing at all, and leaving those columns blank when
   * the answer already sits in the database is wasted data.
   */
  await enrichFromCache(rows, params.country);

  return {
    keyword,
    country: params.country,
    source: sources[0] ?? "google",
    rows,
    counts: countTabs(rows),
    emptySources: [...new Set(emptySources)],
    isMock: provider.isMock,
  };
}

/** How many cached rows to reduce at once — each is CPU only, no network. */
const MAX_FREE_ENRICH = 40;

/**
 * Enriches rows whose results page is already cached, and only those.
 *
 * The cache is checked first so this can never trigger a paid lookup: a miss
 * is skipped rather than fetched. Failures are swallowed per row, because a
 * keyword that cannot be reduced should cost its own columns, not the search.
 */
async function enrichFromCache(
  rows: DeepDiveRow[],
  country: string,
): Promise<void> {
  const provider = getKeywordProvider();
  if (provider.isMock) return;

  const free: DeepDiveRow[] = [];
  for (const row of rows) {
    if (free.length >= MAX_FREE_ENRICH) break;
    try {
      if (await hasFreshSerp(row.keyword, country)) free.push(row);
    } catch {
      /* Cache unavailable — treat as a miss and leave the row blank. */
    }
  }

  await Promise.all(
    free.map(async (row) => {
      try {
        const snapshot = await enrichKeyword(row.keyword, country);
        if (snapshot === null) return;
        row.serp = snapshot;
        if (snapshot.difficulty !== null) row.difficulty = snapshot.difficulty;
      } catch {
        /* One row failing must not fail the search. */
      }
    }),
  );
}

/* ---------------------------------------------------------------------------
 * SERP enrichment — the measured columns
 * ------------------------------------------------------------------------ */

/** Ceiling on one enrichment request, so a click cannot drain the quota. */
export const MAX_ENRICH = 25;

function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? null);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Fetches the first page for one keyword and reduces it to the row's columns.
 *
 * This is the only part of Deep Dive that spends SerpApi quota, which is why it
 * is never triggered by a search — the author picks the rows worth the call.
 * Responses go through the provider's own 7-day cache, so re-analysing a
 * keyword already looked at is free.
 */
export async function enrichKeyword(
  keyword: string,
  country: string,
): Promise<SerpSnapshot | null> {
  const provider = getKeywordProvider();

  let detail;
  try {
    detail = await provider.detail(keyword, country, "en");
  } catch {
    return null;
  }

  const serp = detail.serp;
  if (serp.length === 0) return null;

  /*
   * Page-level referring domains, not domain-level.
   *
   * "Est. Links" answers "how many links would my article need to compete with
   * these", so it has to be links to the competing *page*. Reading the domain
   * figure instead returns amazon.com's whole backlink profile and puts 67,146
   * in a column whose real answers are single digits.
   */
  /*
   * Est. Links answers "how much link strength is already on this page one".
   *
   * Measured against the *domain* of each ranking result, not the page. The
   * page-level figure is modelled as a share of the domain's profile, which
   * puts 11,673 against a Reddit thread whose real answer is about one — a
   * number that shape is worse than no number. The domain figure is an honest
   * estimate of a real quantity: the typical site competing here has roughly
   * this many referring domains, so that is the bar to clear.
   */
  const linkCounts = crawlGraphConfigured()
    ? serp
        .map((r) => r.pageLinkingDomains ?? r.domainLinkingDomains)
        .filter((v): v is number => typeof v === "number")
    : serp
        .map((r) => r.domainLinkingDomains)
        .filter((v): v is number => typeof v === "number");

  const topThree = serp
    .slice(0, 3)
    .map((r) => r.domainAuthority)
    .filter((v): v is number => typeof v === "number");

  return {
    estLinks: median(linkCounts),
    da3: mean(topThree),
    pages: serp.slice(0, 10).map((r) => ({
      domain: r.domain,
      favicon: r.favicon,
      authority: r.domainAuthority,
    })),
    // The provider already reads difficulty off the real SERP for the keyword
    // it analysed, and that beats the volume-based estimate on the row.
    difficulty: detail.difficulty > 0 ? detail.difficulty : null,
    fetchedAt: new Date().toISOString(),
  };
}

export { filterByTab };
export type { DeepDiveTab };
