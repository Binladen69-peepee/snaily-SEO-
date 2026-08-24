/**
 * What is worth doing, found rather than asked for.
 *
 * A forecasting tool that only projects the keywords a user already thought of
 * is a spreadsheet with a chart on it. The value is in the pass over everything
 * the app has already collected, looking for the specific shapes that mean
 * "there is traffic here that you are not getting" — a query sitting at
 * position 11, a page with impressions and no clicks, two pages fighting each
 * other, a page nothing links to.
 *
 * Five of the seven detectors below work with no Search Console connection at
 * all, from cached SERPs and the site audit. That is deliberate: on this
 * deployment no project has Google connected yet, and a Foresight that showed
 * an empty page until somebody did would be worth nothing on the day it
 * shipped.
 */

import type { CtrModel } from "@/lib/foresight/ctr";
import type { Evidence } from "@/lib/foresight/evidence";
import type { SerpFeatureModel } from "@/lib/foresight/serp-features";
import { SERP_FEATURE_LABEL } from "@/lib/foresight/serp-features";
import type { Effort, Opportunity } from "@/lib/foresight/types";
import { figure, unavailableFigure } from "@/lib/foresight/types";

/** Queries between these positions are within reach of a real gain. */
const STRIKING_MIN = 4;
const STRIKING_MAX = 20;

/** Below this many impressions a query is noise, not an opportunity. */
const MIN_IMPRESSIONS = 100;

/** How far below the curve a CTR has to sit before it is worth flagging. */
const CTR_SHORTFALL = 0.6;

const EFFORT_DAYS: Record<Effort, number> = { low: 21, medium: 60, high: 120 };

/**
 * Queries that are somebody looking for this site, not an opportunity.
 *
 * The first run of this engine returned a top four of "cinnamon snail",
 * "cinnamonsnail.com" twice, and "https://cinnamonsnail.com/" — four ways of
 * spelling a navigational search, presented as the most valuable work
 * available. Brand searches already convert; there is no ranking to win.
 */
function isNavigational(query: string, brandTerms: string[]): boolean {
  const q = query.toLowerCase().trim();
  if (q.includes("://") || q.startsWith("www.")) return true;
  if (/\.(com|co|org|net|io|uk)(\/|$)/.test(q)) return true;
  return brandTerms.some((t) => q === t || q.startsWith(`${t} `) || q === `${t}.com`);
}

/**
 * Collapses the same finding arrived at by different spellings.
 *
 * Cached SERPs hold one row per query variant, so a site gets three near
 * identical rows for one question. Keyed on the normalised query plus the kind,
 * so a low-CTR finding and a striking-distance finding for the same query can
 * still both appear — they are different problems.
 */
function dedupe(items: Opportunity[]): Opportunity[] {
  const seen = new Set<string>();
  const kept: Opportunity[] = [];

  const tokens = (item: Opportunity): Set<string> =>
    new Set(
      (item.keyword ?? item.page ?? item.id)
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2),
    );

  for (const item of items) {
    const key = `${item.kind}|${[...tokens(item)].sort().join(" ")}`;
    if (seen.has(key)) continue;

    /*
     * Also collapse near-duplicates within a kind. Three phrasings of the same
     * missing page - "lemon cake recipe with oil instead of butter", "moist
     * lemon cake recipe with oil instead of butter", "cake recipe with oil
     * instead of butter bbc" - are one piece of work, and listing them three
     * times makes a plan look longer than it is.
     */
    /*
     * Only queries get the fuzzy treatment. Two pages whose paths overlap -
     * /vegan-pozole-verde and /vegan-pozole-rojo - are two different pages,
     * each separately blocked from ranking, and collapsing them hid half the
     * technical findings behind a similarity test that was never about them.
     */
    const mine = tokens(item);
    const overlaps = item.keyword === null ? false : kept.some((other) => {
      if (other.keyword === null) return false;
      if (other.kind !== item.kind) return false;
      const theirs = tokens(other);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      const smaller = Math.min(mine.size, theirs.size);
      return smaller > 0 && shared / smaller >= 0.7;
    });
    if (overlaps) continue;

    seen.add(key);
    kept.push(item);
  }

  return kept;
}

function id(kind: string, key: string): string {
  return `${kind}:${key}`.slice(0, 120);
}

/**
 * Ranks an opportunity on a 0–100 scale that survives missing demand data.
 *
 * Modelled clicks are the right measure when they exist. When search volume is
 * unavailable — which is the normal case here, because this app deliberately
 * refuses to fabricate it — impressions, position and gap size still order the
 * list sensibly, and the card says the click figure is unavailable rather than
 * printing a number nobody can source.
 */
function impactScore(opts: {
  impressions: number;
  positionGap: number;
  ctrShortfall: number;
  pageValue: number;
}): number {
  const reach = Math.min(50, Math.log10(Math.max(1, opts.impressions)) * 14);
  const gain = Math.min(25, opts.positionGap * 2.5);
  const shortfall = Math.min(15, opts.ctrShortfall * 30);
  const value = Math.min(10, Math.log10(Math.max(1, opts.pageValue)) * 4);
  return Math.round(reach + gain + shortfall + value);
}

/* -------------------------------------------------------------------------
 * Detectors
 * ---------------------------------------------------------------------- */

/** Queries close enough to page one that a modest push pays. */
function strikingDistance(
  evidence: Evidence,
  ctr: CtrModel,
  serpModel: SerpFeatureModel,
  targetPosition: number,
): Opportunity[] {
  return evidence.queries
    .filter(
      (q) =>
        q.impressions >= MIN_IMPRESSIONS &&
        q.position >= STRIKING_MIN &&
        q.position <= STRIKING_MAX &&
        !isNavigational(q.query, evidence.brandTerms),
    )
    .slice(0, 60)
    .map((q) => {
      const features = evidence.serps.find((s) => s.query === q.query)?.features ?? [];
      const adjust = serpModel.multiplierFor(features);
      const target = Math.max(1, Math.min(targetPosition, Math.floor(q.position) - 1));

      // Impressions are the honest demand proxy: they are measured, they are
      // first-party, and they need no keyword-volume provider to exist.
      const perMonth = q.days > 0 ? (q.impressions / q.days) * 30 : q.impressions;
      const gain = Math.max(0, ctr.rate(target) - ctr.rate(q.position)) * adjust * perMonth;

      return {
        id: id("striking-distance", q.query),
        kind: "striking-distance" as const,
        title: `“${q.query}” — position ${q.position.toFixed(1)} → top ${String(target)}`,
        detail: `${q.impressions.toLocaleString()} impressions already, at an average position of ${q.position.toFixed(1)}. Moving to position ${String(target)} is a small climb on a query Google already shows you for.`,
        impactClicks: figure(
          Math.round(gain),
          "modeled",
          `Impressions measured by Search Console × the change in click-through between position ${q.position.toFixed(1)} and ${String(target)}${features.length > 0 ? `, reduced for ${features.map((f) => SERP_FEATURE_LABEL[f]).join(", ")} on this SERP` : ""}.`,
          "Google Search Console",
        ),
        impactScore: impactScore({
          impressions: q.impressions,
          positionGap: q.position - target,
          ctrShortfall: 0,
          pageValue: q.clicks,
        }),
        effort: (q.position <= 10 ? "low" : "medium") as Effort,
        confidence: 0.7,
        timeToImpactDays: q.position <= 10 ? 30 : 75,
        action:
          q.position <= 10
            ? `Refresh the page targeting “${q.query}” - title, opening section, and internal links from your strongest related pages.`
            : `Expand the page targeting “${q.query}” to cover it properly, then build internal links to it.`,
        keyword: q.query,
        page: null,
        evidence: [
          {
            label: "Impressions",
            detail: `${q.impressions.toLocaleString()} over ${String(q.days)} days`,
            provenance: "real" as const,
          },
          {
            label: "Average position",
            detail: q.position.toFixed(1),
            provenance: "real" as const,
          },
        ],
      };
    });
}

/** Queries Google shows a lot and nobody clicks. */
function lowCtr(evidence: Evidence, ctr: CtrModel, serpModel: SerpFeatureModel): Opportunity[] {
  return evidence.queries
    .filter(
      (q) =>
        q.impressions >= MIN_IMPRESSIONS * 3 &&
        q.position <= 10 &&
        !isNavigational(q.query, evidence.brandTerms),
    )
    .map((q) => {
      const features = evidence.serps.find((s) => s.query === q.query)?.features ?? [];
      const expected = ctr.rate(q.position) * serpModel.multiplierFor(features);
      const ratio = expected > 0 ? q.ctr / expected : 1;
      return { q, features, expected, ratio };
    })
    .filter((x) => x.ratio < CTR_SHORTFALL && x.expected > 0)
    .slice(0, 30)
    .map(({ q, features, expected, ratio }) => {
      const perMonth = q.days > 0 ? (q.impressions / q.days) * 30 : q.impressions;
      const recoverable = Math.max(0, expected - q.ctr) * perMonth * 0.6;

      return {
        id: id("low-ctr", q.query),
        kind: "low-ctr" as const,
        title: `“${q.query}” — ${(q.ctr * 100).toFixed(1)}% click-through at position ${q.position.toFixed(1)}`,
        detail: `The page ranks well but earns ${String(Math.round(ratio * 100))}% of the clicks the curve expects at that position${features.length > 0 ? `, even after allowing for ${features.map((f) => SERP_FEATURE_LABEL[f]).join(", ")}` : ""}. That is a title and snippet problem, not a ranking problem.`,
        impactClicks: figure(
          Math.round(recoverable),
          "modeled",
          "Two-thirds of the gap between measured click-through and what the curve expects at this position. Held to two-thirds because no title rewrite recovers the whole shortfall.",
          "Google Search Console",
        ),
        impactScore: impactScore({
          impressions: q.impressions,
          positionGap: 0,
          ctrShortfall: 1 - ratio,
          pageValue: q.clicks,
        }),
        effort: "low" as Effort,
        confidence: 0.6,
        timeToImpactDays: 21,
        action: `Rewrite the title and meta description for “${q.query}” to match its intent, and check what the SERP features above you are answering.`,
        keyword: q.query,
        page: null,
        evidence: [
          {
            label: "Measured CTR",
            detail: `${(q.ctr * 100).toFixed(2)}%`,
            provenance: "real" as const,
          },
          {
            label: "Expected CTR",
            detail: `${(expected * 100).toFixed(2)}% at position ${q.position.toFixed(1)}`,
            provenance: ctr.summary.source === "site" ? ("derived" as const) : ("estimated" as const),
          },
        ],
      };
    });
}

/**
 * Words too common on this site to mean two pages are related.
 *
 * Built from the site's own titles rather than from a fixed English stop-list,
 * because the words that carry no information are site-specific: on a vegan
 * recipe blog, "vegan" and "recipe" appear in most titles and match nothing in
 * particular. Without this the gap detector reported "link it from the 347
 * related pages you already have", which is both useless as advice and a
 * visible sign that the relatedness test is not testing relatedness.
 */
function commonWords(titles: string[]): Set<string> {
  if (titles.length < 20) return new Set();

  const counts = new Map<string, number>();
  for (const title of titles) {
    for (const word of new Set(title.split(/[^a-z0-9]+/).filter((w) => w.length > 3))) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  const ceiling = titles.length * 0.12;
  return new Set([...counts.entries()].filter(([, n]) => n > ceiling).map(([w]) => w));
}

/** Cached SERPs the site does not appear on but plainly could. */
function contentGaps(evidence: Evidence): Opportunity[] {
  const titles = evidence.contentTitles.map((t) => t.toLowerCase());
  const common = commonWords(titles);

  return evidence.serps
    .filter(
      (s) =>
        s.ownPosition === null &&
        s.competitors.length >= 5 &&
        !isNavigational(s.query, evidence.brandTerms),
    )
    .map((s) => {
      /*
       * Overlap with what the site already publishes, on distinctive words
       * only, and requiring two of them. One shared word is a coincidence; two
       * uncommon ones is a topic.
       */
      const words = s.query
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3 && !common.has(w));

      const related =
        words.length < 2
          ? 0
          : titles.filter((t) => words.filter((w) => t.includes(w)).length >= 2).length;

      return { s, related, words };
    })
    .filter((x) => x.related >= 1)
    .sort((a, b) => b.related - a.related)
    .slice(0, 25)
    .map(({ s, related }) => ({
      id: id("content-gap", s.query),
      kind: "content-gap" as const,
      title: `No page for “${s.query}”`,
      detail: `Nothing on this site ranks for this query, though ${String(related)} of your pages cover closely related ground. ${String(s.competitors.length)} results compete for it${s.features.length > 0 ? `, with ${s.features.map((f) => SERP_FEATURE_LABEL[f]).join(", ")} on the page` : ""}.`,
      // No measured demand for a query the site has never appeared on, and this
      // app does not invent search volume. The relative score still orders it.
      impactClicks: unavailableFigure(
        "This query has no Search Console impressions because the site does not rank for it, and no trusted search-volume source is connected. The impact score below orders it against the others without inventing a click figure.",
      ),
      impactScore: impactScore({
        impressions: 0,
        positionGap: 20,
        ctrShortfall: 0,
        pageValue: related,
      }),
      effort: "high" as Effort,
      confidence: 0.35,
      timeToImpactDays: 120,
      action: `Write a page targeting “${s.query}”, and link it from your closest existing pages.`,
      keyword: s.query,
      page: null,
      evidence: [
        {
          label: "Competing results",
          detail: `${String(s.competitors.length)} organic results, from a cached SERP`,
          provenance: "real" as const,
        },
        {
          label: "Related pages on your site",
          detail: String(related),
          provenance: "derived" as const,
        },
        ...(s.features.length > 0
          ? [
              {
                label: "SERP features",
                detail: s.features.map((f) => SERP_FEATURE_LABEL[f]).join(", "),
                provenance: "real" as const,
              },
            ]
          : []),
      ],
    }));
}

/** Pages earning impressions that nothing internal points at. */
function internalLinkGaps(evidence: Evidence): Opportunity[] {
  return evidence.pages
    .filter((p) => p.indexable && p.internalLinks <= 2 && p.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20)
    .map((p) => ({
      id: id("internal-links", p.path),
      kind: "internal-links" as const,
      title: `${p.path} has ${String(p.internalLinks)} internal link${p.internalLinks === 1 ? "" : "s"}`,
      detail: `The page earns ${p.impressions.toLocaleString()} impressions at position ${p.position.toFixed(1)} with almost nothing linking to it. Internal links are the cheapest ranking signal you control outright.`,
      impactClicks: unavailableFigure(
        "The click effect of internal linking cannot be isolated from Search Console data, so no number is claimed. The position and impressions behind the recommendation are real.",
      ),
      impactScore: impactScore({
        impressions: p.impressions,
        positionGap: Math.max(0, p.position - 5),
        ctrShortfall: 0,
        pageValue: p.clicks,
      }),
      effort: "low" as Effort,
      confidence: 0.5,
      timeToImpactDays: 30,
      action: `Link to ${p.path} from three or four of your strongest related pages.`,
      keyword: null,
      page: p.url,
      evidence: [
        { label: "Internal links", detail: String(p.internalLinks), provenance: "real" as const },
        {
          label: "Impressions",
          detail: p.impressions.toLocaleString(),
          provenance: "real" as const,
        },
      ],
    }));
}

/** Pages that cannot rank until something is fixed. */
function technicalBlockers(evidence: Evidence): Opportunity[] {
  return evidence.pages
    .filter((p) => !p.indexable || p.blockingIssues > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20)
    .map((p) => ({
      id: id("technical", p.path),
      kind: "technical" as const,
      title: `${p.path} is blocked from ranking`,
      detail: p.indexable
        ? `${String(p.blockingIssues)} blocking issue${p.blockingIssues === 1 ? "" : "s"} found in the last audit. Until they are cleared, no amount of content work moves this page.`
        : "The last audit found this page non-indexable. Nothing else on this list matters for it until that is fixed.",
      impactClicks: unavailableFigure(
        "A blocked page has no measurable ceiling until it is unblocked, so no click figure is modelled.",
      ),
      impactScore: impactScore({
        impressions: Math.max(p.impressions, 200),
        positionGap: 15,
        ctrShortfall: 0,
        pageValue: p.clicks,
      }),
      effort: "low" as Effort,
      confidence: 0.85,
      timeToImpactDays: 21,
      action: `Fix what is blocking ${p.path} from being indexed, then request re-indexing.`,
      keyword: null,
      page: p.url,
      evidence: [
        {
          label: "Indexable",
          detail: p.indexable ? "yes, but blocked by other issues" : "no",
          provenance: "real" as const,
        },
      ],
    }));
}

/** Pairs of pages competing for the same intent. */
function cannibalization(
  groups: { pages: { path: string; url: string; title: string }[]; reason: string }[],
): Opportunity[] {
  return groups.slice(0, 12).map((g) => ({
    id: id("cannibalization", g.pages[0]!.path),
    kind: "cannibalization" as const,
    title: `${String(g.pages.length)} pages competing: ${g.pages[0]!.title.slice(0, 60)}`,
    detail: `${g.reason} Consolidating them concentrates the signals Google is currently splitting between ${String(g.pages.length)} URLs.`,
    impactClicks: unavailableFigure(
      "Consolidation gains depend on how Google reallocates the merged signals, which cannot be modelled from the data here. The overlap itself is measured from your audit.",
    ),
    impactScore: 45 + g.pages.length * 5,
    effort: "medium" as Effort,
    confidence: 0.45,
    timeToImpactDays: 60,
    action: `Merge ${String(g.pages.length)} overlapping pages into the strongest one and redirect the rest (starting ${g.pages[0]!.path}).`,
    keyword: null,
    page: g.pages[0]!.url,
    evidence: g.pages.slice(0, 4).map((p) => ({
      label: "Competing page",
      detail: p.path,
      provenance: "real" as const,
    })),
  }));
}

/** SERP features the site could plausibly win. */
function serpFeatureTargets(evidence: Evidence): Opportunity[] {
  return evidence.serps
    .filter(
      (s) =>
        s.ownPosition !== null &&
        s.ownPosition <= 10 &&
        !isNavigational(s.query, evidence.brandTerms) &&
        (s.features.includes("related_questions") || s.features.includes("answer_box")),
    )
    .slice(0, 15)
    .map((s) => ({
      id: id("serp-feature", s.query),
      kind: "serp-feature" as const,
      title: `“${s.query}” has ${s.features.includes("answer_box") ? "a featured snippet" : "a People Also Ask block"}`,
      detail: `You already rank at position ${String(s.ownPosition)}. Answering the question directly, in the format the feature uses, is how pages win these slots.`,
      impactClicks: unavailableFigure(
        "Winning a SERP feature is binary and cannot be modelled as an incremental click count from the data available here.",
      ),
      impactScore: 40 + (11 - (s.ownPosition ?? 10)) * 3,
      effort: "low" as Effort,
      confidence: 0.4,
      timeToImpactDays: 45,
      action: `Answer “${s.query}” directly near the top of the page, formatted the way the feature presents it.`,
      keyword: s.query,
      page: null,
      evidence: [
        {
          label: "Your position",
          detail: String(s.ownPosition),
          provenance: "real" as const,
        },
        {
          label: "Feature present",
          detail: s.features.map((f) => SERP_FEATURE_LABEL[f]).join(", "),
          provenance: "real" as const,
        },
      ],
    }));
}

/* -------------------------------------------------------------------------
 * Assembly
 * ---------------------------------------------------------------------- */

export function findOpportunities(input: {
  evidence: Evidence;
  ctr: CtrModel;
  serpModel: SerpFeatureModel;
  targetPosition: number;
  cannibalGroups: { pages: { path: string; url: string; title: string }[]; reason: string }[];
}): Opportunity[] {
  const all = [
    ...strikingDistance(input.evidence, input.ctr, input.serpModel, input.targetPosition),
    ...lowCtr(input.evidence, input.ctr, input.serpModel),
    ...technicalBlockers(input.evidence),
    ...internalLinkGaps(input.evidence),
    ...cannibalization(input.cannibalGroups),
    ...serpFeatureTargets(input.evidence),
    ...contentGaps(input.evidence),
  ];

  /*
   * Ordered by impact per unit of effort rather than by impact alone. A
   * roadmap sorted purely on upside puts a six-month content programme above
   * a title rewrite that pays next week, which is how these lists end up
   * unread.
   */
  const weight: Record<Effort, number> = { low: 1, medium: 1.9, high: 3.4 };

  return dedupe(all)
    .sort((a, b) => b.impactScore / weight[b.effort] - a.impactScore / weight[a.effort])
    .slice(0, 60);
}

export { EFFORT_DAYS };
