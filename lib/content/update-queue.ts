import { prisma } from "@/lib/db";
import { toPath } from "@/lib/google/performance";

/**
 * Which posts need updating, and why.
 *
 * This is the question Occasio and Clariti exist to answer, and it is only
 * answerable now that WordPress content and Search Console performance are both
 * stored: word count and staleness alone say nothing, and traffic alone says
 * nothing about the page behind it. The join is the product.
 *
 * Scores follow the same rule as the rest of the app — the number is the plain
 * sum of the reasons shown beside it, so it can always be argued with.
 */

/** Comparison window. Two of these back to back give the decay signal. */
const WINDOW_DAYS = 28;

/** Below this, a post is thin enough that length is plausibly the problem. */
const THIN_WORDS = 300;

/** Google reports lag about two days; ignore that tail so it is not read as a drop. */
const REPORTING_LAG_DAYS = 2;

export type UpdateReason = {
  label: string;
  detail: string;
  points: number;
};

export type PostPerformance = {
  clicks: number;
  impressions: number;
  ctr: number;
  /** Impression-weighted average Google position. */
  position: number;
  clicksPrior: number;
  /** Percentage change against the prior window; null when there is no prior data. */
  changePct: number | null;
};

export type ScoredPost = {
  id: string;
  wpId: number;
  type: string;
  status: string;
  title: string;
  link: string;
  wordCount: number;
  seoScore: number | null;
  focusKeyword: string;
  categories: string[];
  publishedAt: string | null;
  modifiedAt: string | null;
  /** Null when Search Console has never reported this URL. */
  performance: PostPerformance | null;
  /** 0–100. The plain sum of `reasons`. */
  score: number;
  reasons: UpdateReason[];
};

type Totals = { clicks: number; impressions: number; positionWeighted: number };

/** Per-path totals for one date window, keyed by normalised pathname. */
async function windowTotals(
  projectId: string,
  from: Date,
  to: Date,
): Promise<Map<string, Totals>> {
  const rows = await prisma.gscPageMetric.groupBy({
    by: ["page"],
    where: { projectId, date: { gte: from, lt: to } },
    _sum: { clicks: true, impressions: true },
    _avg: { position: true },
  });

  const map = new Map<string, Totals>();

  for (const row of rows) {
    // Several reported URLs can normalise onto one path (trailing slash, query
    // strings), so totals accumulate rather than overwrite.
    const path = toPath(row.page);
    const clicks = row._sum.clicks ?? 0;
    const impressions = row._sum.impressions ?? 0;
    const position = row._avg.position ?? 0;

    const existing = map.get(path);
    if (existing) {
      existing.clicks += clicks;
      existing.impressions += impressions;
      existing.positionWeighted += position * impressions;
    } else {
      map.set(path, {
        clicks,
        impressions,
        positionWeighted: position * impressions,
      });
    }
  }

  return map;
}

function monthsSince(iso: Date | null): number | null {
  if (iso === null) return null;
  return (Date.now() - iso.getTime()) / (30 * 86_400_000);
}

/**
 * Reasons a single post might deserve attention.
 *
 * Each reason has to be defensible on its own — a post is never flagged just
 * for scoring badly on an aggregate. Where a signal needs traffic to mean
 * anything, it is gated on traffic existing.
 */
function reasonsFor(
  post: {
    wordCount: number;
    seoScore: number | null;
    focusKeyword: string;
    modifiedAt: Date | null;
    publishedAt: Date | null;
  },
  perf: PostPerformance | null,
): UpdateReason[] {
  const reasons: UpdateReason[] = [];
  const age = monthsSince(post.modifiedAt);

  // 1. Losing traffic it used to have — the clearest refresh signal there is.
  if (perf !== null && perf.changePct !== null && perf.clicksPrior >= 5) {
    if (perf.changePct <= -50) {
      reasons.push({
        label: "Traffic collapsed",
        detail: `${String(perf.clicksPrior)} → ${String(perf.clicks)} clicks (${String(Math.round(perf.changePct))}%)`,
        points: 40,
      });
    } else if (perf.changePct <= -25) {
      reasons.push({
        label: "Traffic declining",
        detail: `${String(perf.clicksPrior)} → ${String(perf.clicks)} clicks (${String(Math.round(perf.changePct))}%)`,
        points: 25,
      });
    }
  }

  // 2. Google shows it, nobody clicks — usually a title/meta problem.
  if (perf !== null && perf.impressions >= 100 && perf.ctr < 0.01) {
    reasons.push({
      label: "Seen but not clicked",
      detail: `${perf.impressions.toLocaleString("en-US")} impressions, ${String(Math.round(perf.ctr * 1000) / 10)}% CTR`,
      points: 20,
    });
  }

  // 3. Close enough to page one that a push is worth it.
  if (perf !== null && perf.impressions >= 50 && perf.position > 3 && perf.position <= 20) {
    reasons.push({
      label: "Striking distance",
      detail: `average position ${String(Math.round(perf.position * 10) / 10)}`,
      points: perf.position <= 10 ? 18 : 12,
    });
  }

  // 4. Thin, but Google is already showing it — length is the likely gap.
  if (post.wordCount < THIN_WORDS && perf !== null && perf.impressions > 0) {
    reasons.push({
      label: "Thin content with demand",
      detail: `${String(post.wordCount)} words against ${perf.impressions.toLocaleString("en-US")} impressions`,
      points: 18,
    });
  }

  // 5. Old and earning — refreshing what already works is the cheapest win.
  if (age !== null && age >= 12 && perf !== null && perf.clicks > 0) {
    reasons.push({
      label: "Stale but still earning",
      detail: `last updated ${String(Math.round(age))} months ago, ${String(perf.clicks)} clicks`,
      points: age >= 24 ? 16 : 10,
    });
  }

  // 6. The site's own SEO plugin is unhappy with it.
  if (post.seoScore !== null && post.seoScore < 40) {
    reasons.push({
      label: "Weak SEO score",
      detail: `scores ${String(post.seoScore)} in the site's SEO plugin`,
      points: 12,
    });
  }

  // 7. Published long enough to have been found, and never was.
  const published = monthsSince(post.publishedAt);
  if (published !== null && published >= 3 && (perf === null || perf.impressions === 0)) {
    reasons.push({
      label: "No search visibility",
      detail: "no impressions recorded in the last 28 days",
      points: 14,
    });
  }

  // 8. Cheap to fix, and it drives everything the SEO plugin measures.
  if (post.focusKeyword === "" && post.seoScore === null) {
    reasons.push({
      label: "No focus keyword",
      detail: "nothing set for the SEO plugin to measure against",
      points: 6,
    });
  }

  return reasons;
}

export type UpdateQueue = {
  posts: ScoredPost[];
  /** True when Search Console has never synced, so traffic signals are absent. */
  missingPerformance: boolean;
};

export async function buildUpdateQueue(projectId: string): Promise<UpdateQueue> {
  const now = new Date();
  const recentTo = new Date(now.getTime() - REPORTING_LAG_DAYS * 86_400_000);
  const recentFrom = new Date(recentTo.getTime() - WINDOW_DAYS * 86_400_000);
  const priorFrom = new Date(recentFrom.getTime() - WINDOW_DAYS * 86_400_000);

  const [posts, recent, prior] = await Promise.all([
    prisma.wpPost.findMany({
      where: { projectId },
      select: {
        id: true, wpId: true, type: true, status: true, title: true, link: true,
        wordCount: true, seoScore: true, focusKeyword: true, categories: true,
        publishedAt: true, modifiedAt: true,
      },
    }),
    windowTotals(projectId, recentFrom, recentTo),
    windowTotals(projectId, priorFrom, recentFrom),
  ]);

  const scored: ScoredPost[] = posts.map((post) => {
    const path = toPath(post.link);
    const now = recent.get(path);
    const before = prior.get(path);

    const performance: PostPerformance | null =
      now === undefined && before === undefined
        ? null
        : {
            clicks: now?.clicks ?? 0,
            impressions: now?.impressions ?? 0,
            ctr:
              now === undefined || now.impressions === 0
                ? 0
                : now.clicks / now.impressions,
            position:
              now === undefined || now.impressions === 0
                ? 0
                : now.positionWeighted / now.impressions,
            clicksPrior: before?.clicks ?? 0,
            changePct:
              before === undefined || before.clicks === 0
                ? null
                : (((now?.clicks ?? 0) - before.clicks) / before.clicks) * 100,
          };

    const reasons = reasonsFor(post, performance);

    return {
      ...post,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      modifiedAt: post.modifiedAt?.toISOString() ?? null,
      performance,
      score: Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0)),
      reasons,
    };
  });

  return {
    posts: scored,
    missingPerformance: recent.size === 0 && prior.size === 0,
  };
}
