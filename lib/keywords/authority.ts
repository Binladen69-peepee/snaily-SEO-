/**
 * Link-authority metric provenance.
 *
 * PA, DA, referring domains and backlink counts come from a crawled backlink
 * index — Moz, Majestic, Ahrefs, DataForSEO. This deployment has no such
 * provider, so it cannot know them.
 *
 * They used to be produced by hashing `domain|position`, which made them look
 * authoritative while being noise: the same site scored DA 89 at rank 1 and 68
 * at rank 5, and a domain that does not exist outscored nytimes.com. A client
 * whose real DA is 48–51 was shown 71.
 *
 * The rule now: a metric is either measured, explicitly labelled an estimate
 * derived from something real, or reported as unavailable. Nothing is invented.
 */

export type MetricSource =
  /** Measured by a first-party API — Search Console, or the live SERP. */
  | "measured"
  /** Derived from something measured; the UI must say so. */
  | "estimated"
  /** No configured provider supplies it. */
  | "unavailable";

export type Metric = {
  value: number | null;
  source: MetricSource;
  /** Shown on hover so a number can always be traced. */
  note: string;
};

export const UNAVAILABLE_NOTE =
  "Not provided by the current data source. Link metrics need a backlink index (Moz, Majestic or DataForSEO).";

export function unavailable(): Metric {
  return { value: null, source: "unavailable", note: UNAVAILABLE_NOTE };
}

export function measured(value: number, note: string): Metric {
  return { value, source: "measured", note };
}

export function estimated(value: number, note: string): Metric {
  return { value, source: "estimated", note };
}

/** True when any real backlink provider is configured. None is today. */
export function backlinkProviderConfigured(): boolean {
  return (
    (process.env.MOZ_ACCESS_ID ?? "").trim() !== "" ||
    (process.env.DATAFORSEO_LOGIN ?? "").trim() !== ""
  );
}

/* -------------------------------------------------------------------------
 * Real difficulty, from what a SERP actually tells us.
 * ---------------------------------------------------------------------- */

/** Sites whose presence signals a beatable page rather than a strong one. */
const UGC_HOSTS = [
  "reddit.com",
  "quora.com",
  "pinterest.com",
  "facebook.com",
  "youtube.com",
  "tiktok.com",
  "medium.com",
  "answers.com",
];

/** Hard-to-displace publishers and reference sites. */
const AUTHORITY_HOSTS = [
  "wikipedia.org",
  "nytimes.com",
  "bbc.co.uk",
  "healthline.com",
  "webmd.com",
  "britannica.com",
  "forbes.com",
  "amazon.com",
  "allrecipes.com",
  "seriouseats.com",
  "bonappetit.com",
  "foodnetwork.com",
];

export type DifficultyReason = { label: string; detail: string; points: number };

export type SerpDifficulty = {
  score: number;
  reasons: DifficultyReason[];
};

function hostMatches(domain: string, list: string[]): boolean {
  return list.some((h) => domain === h || domain.endsWith(`.${h}`));
}

/**
 * Keyword difficulty from observable SERP composition.
 *
 * Every input here is something the SERP response actually contains, so the
 * score is reproducible from the same page of results. It replaces a score
 * that averaged fabricated PA/DA values — which meant difficulty inherited
 * the fabrication.
 *
 * The score is the plain sum of the reasons, capped at 100.
 */
export function difficultyFromSerpComposition(
  results: { domain: string; title: string; url: string }[],
  keyword: string,
  totalResults: number | null,
): SerpDifficulty {
  const reasons: DifficultyReason[] = [];

  if (results.length === 0) {
    return {
      score: 0,
      reasons: [
        { label: "No results", detail: "nothing ranked to measure", points: 0 },
      ],
    };
  }

  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  const top = results.slice(0, 10);

  // 1. Established publishers holding slots — up to 35.
  const bigNames = top.filter((r) => hostMatches(r.domain, AUTHORITY_HOSTS));
  if (bigNames.length >= 5) {
    reasons.push({
      label: "Dominated by major publishers",
      detail: `${String(bigNames.length)} of ${String(top.length)} results are large established sites`,
      points: 35,
    });
  } else if (bigNames.length >= 3) {
    reasons.push({
      label: "Several major publishers",
      detail: `${String(bigNames.length)} of ${String(top.length)} results`,
      points: 24,
    });
  } else if (bigNames.length >= 1) {
    reasons.push({
      label: "A major publisher present",
      detail: `${String(bigNames.length)} of ${String(top.length)} results`,
      points: 12,
    });
  } else {
    reasons.push({
      label: "No dominant publishers",
      detail: "the first page is open to smaller sites",
      points: 2,
    });
  }

  // 2. Forums and social are displaceable — they lower difficulty.
  const ugc = top.filter((r) => hostMatches(r.domain, UGC_HOSTS));
  if (ugc.length >= 3) {
    reasons.push({
      label: "Forums and social fill the page",
      detail: `${String(ugc.length)} UGC results — a real article can outrank these`,
      points: 0,
    });
  } else if (ugc.length >= 1) {
    reasons.push({
      label: "Some user-generated results",
      detail: `${String(ugc.length)} of ${String(top.length)} are forums or social`,
      points: 6,
    });
  } else {
    reasons.push({
      label: "All editorial results",
      detail: "no forum or social pages to displace",
      points: 16,
    });
  }

  // 3. How deliberately the ranking pages target the phrase — up to 25.
  const optimised = top.filter((r) => {
    const t = r.title.toLowerCase();
    return words.length > 0 && words.every((w) => t.includes(w));
  }).length;

  if (optimised >= 8) {
    reasons.push({
      label: "Nearly every title targets this phrase",
      detail: `${String(optimised)} of ${String(top.length)} titles contain it`,
      points: 25,
    });
  } else if (optimised >= 5) {
    reasons.push({
      label: "Most titles target this phrase",
      detail: `${String(optimised)} of ${String(top.length)}`,
      points: 17,
    });
  } else if (optimised >= 2) {
    reasons.push({
      label: "Some titles target this phrase",
      detail: `${String(optimised)} of ${String(top.length)}`,
      points: 9,
    });
  } else {
    reasons.push({
      label: "Few titles target this phrase",
      detail: `only ${String(optimised)} — an opening`,
      points: 2,
    });
  }

  // 4. Breadth of competition — up to 12.
  const distinct = new Set(top.map((r) => r.domain)).size;
  if (distinct >= 9) {
    reasons.push({
      label: "Every slot a different site",
      detail: `${String(distinct)} distinct domains competing`,
      points: 12,
    });
  } else {
    reasons.push({
      label: "Concentrated competition",
      detail: `${String(distinct)} distinct domains across ${String(top.length)} results`,
      points: 6,
    });
  }

  // 5. Corpus size — up to 12.
  if (totalResults !== null && totalResults > 0) {
    if (totalResults >= 50_000_000) {
      reasons.push({
        label: "Very large index",
        detail: `${totalResults.toLocaleString("en-US")} indexed pages`,
        points: 12,
      });
    } else if (totalResults >= 5_000_000) {
      reasons.push({
        label: "Large index",
        detail: `${totalResults.toLocaleString("en-US")} indexed pages`,
        points: 7,
      });
    } else {
      reasons.push({
        label: "Modest index",
        detail: `${totalResults.toLocaleString("en-US")} indexed pages`,
        points: 3,
      });
    }
  }

  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  return { score: Math.max(1, Math.min(100, score)), reasons };
}
