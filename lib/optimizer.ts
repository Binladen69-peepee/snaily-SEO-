import * as cheerio from "cheerio";

import { countPhrase, weighTerm, type TargetTerm } from "@/lib/content-score";
import { difficultyFromSerpComposition } from "@/lib/keywords/authority";
import { hydrateKeyword } from "@/lib/keywords/hydrate";
import { getNormalizedSerp } from "@/lib/keywords/get-normalized-serp";
import type { NormalizedSerp } from "@/lib/keywords/serp-normalized";
import {
  extractEntities,
  extractQuestions,
  extractTerms,
  tokenize,
  wordCount,
  type TermCount,
} from "@/lib/text";

/**
 * Content Optimizer.
 *
 * Takes a keyword, reads the pages already ranking for it, and reports what
 * they have in common: length, headings, recurring terms, entities and the
 * questions they answer. Optionally compares your own page against that brief.
 *
 * Everything is measured from pages we actually fetched — no model, no guessed
 * "AI score". The content score is the sum of the reasons listed with it.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PAGES = 8;
const USER_AGENT = "SEOToolBot/1.0 (+content optimizer)";

export type Heading = { level: 2 | 3; text: string };

export type PageContent = {
  url: string;
  domain: string;
  title: string;
  metaDescription: string;
  h1: string;
  headings: Heading[];
  text: string;
  words: number;
  images: number;
  links: number;
  ok: boolean;
};

export type ScoreReason = { label: string; detail: string; points: number };

export type Coverage = {
  term: string;
  /** Competitor pages using it. */
  documents: number;
  /** Times it appears on your page. */
  yours: number;
  used: boolean;
};

export type Brief = {
  keyword: string;
  /** Headline metrics for the keyword itself, from the provider. */
  keywordMetrics: { difficulty: number; volume: number; cpc: number };
  /** Competitor pages successfully read. */
  analysed: PageContent[];
  /** Pages the crawler could not read (blocked, timed out, non-HTML). */
  skipped: string[];
  targetWords: { median: number; min: number; max: number };
  headings: { text: string; count: number }[];
  terms: { single: TermCount[]; double: TermCount[]; triple: TermCount[] };
  entities: TermCount[];
  questions: string[];
  /**
   * Everything the draft is graded against, ranked by importance. Sent to the
   * browser so the editor can re-check coverage on every keystroke.
   */
  targets: TargetTerm[];
  /** Words the ranking pages put in their own titles, most common first. */
  titleWords: string[];
  /** Live SERP snapshot used to build this brief (one provider call). */
  serpSnapshot: NormalizedSerp | null;
  /** Present only when a URL was supplied. */
  target?: {
    page: PageContent;
    score: number;
    reasons: ScoreReason[];
    coverage: Coverage[];
    missing: Coverage[];
  };
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Reads one page and pulls out the parts that matter for a content brief. */
export async function readPage(url: string): Promise<PageContent> {
  const empty: PageContent = {
    url,
    domain: hostOf(url),
    title: "",
    metaDescription: "",
    h1: "",
    headings: [],
    text: "",
    words: 0,
    images: 0,
    links: 0,
    ok: false,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
  } catch {
    return empty;
  }

  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) {
    return empty;
  }

  const $ = cheerio.load(await res.text());
  $("script, style, noscript, svg, nav, footer, header, aside, form").remove();

  // Prefer the article body when the page marks one up; fall back to <body>.
  const root = ["article", "main", "[role='main']", ".post-content", ".entry-content"]
    .map((sel) => $(sel).first())
    .find((el) => el.length > 0 && el.text().trim().length > 400) ?? $("body");

  const headings: Heading[] = [];
  root.find("h2, h3").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text === "" || text.length > 120) return;
    headings.push({ level: el.tagName.toLowerCase() === "h2" ? 2 : 3, text });
  });

  const text = root.text().replace(/\s+/g, " ").trim();

  return {
    url: res.url,
    domain: hostOf(res.url),
    title: $("title").first().text().trim(),
    metaDescription: ($("meta[name='description']").attr("content") ?? "").trim(),
    h1: $("h1").first().text().replace(/\s+/g, " ").trim(),
    headings: headings.slice(0, 40),
    text,
    words: wordCount(text),
    images: root.find("img").length,
    links: root.find("a[href]").length,
    ok: text.length > 200,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

/**
 * Scores a page against the brief. The score is the plain sum of the reasons —
 * add the points shown and you get the number back.
 */
function scoreTarget(
  page: PageContent,
  keyword: string,
  brief: Pick<Brief, "targetWords" | "headings">,
  coverage: Coverage[],
): { score: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  const kw = keyword.toLowerCase();

  // 1. Keyword placement — 30 points.
  if (page.title.toLowerCase().includes(kw)) {
    reasons.push({
      label: "Keyword in the title tag",
      detail: "the strongest single on-page signal",
      points: 12,
    });
  }
  if (page.h1.toLowerCase().includes(kw)) {
    reasons.push({
      label: "Keyword in the H1",
      detail: "matches the page's main heading",
      points: 8,
    });
  }
  if (page.metaDescription.toLowerCase().includes(kw)) {
    reasons.push({
      label: "Keyword in the meta description",
      detail: "helps click-through, not ranking directly",
      points: 4,
    });
  }
  if (page.headings.some((h) => h.text.toLowerCase().includes(kw))) {
    reasons.push({
      label: "Keyword in a subheading",
      detail: "reinforces the topic through the body",
      points: 6,
    });
  }

  // 2. Length against what already ranks — 25 points.
  const target = brief.targetWords.median;
  if (target > 0) {
    const ratio = page.words / target;
    if (ratio >= 0.9) {
      reasons.push({
        label: "Length matches the ranking pages",
        detail: `${String(page.words)} words vs a median of ${String(target)}`,
        points: 25,
      });
    } else if (ratio >= 0.6) {
      reasons.push({
        label: "Slightly short",
        detail: `${String(page.words)} words vs a median of ${String(target)}`,
        points: 15,
      });
    } else if (ratio >= 0.3) {
      reasons.push({
        label: "Well under the ranking pages",
        detail: `${String(page.words)} words vs a median of ${String(target)}`,
        points: 7,
      });
    } else {
      reasons.push({
        label: "Far too short",
        detail: `${String(page.words)} words vs a median of ${String(target)}`,
        points: 0,
      });
    }
  }

  // 3. Topic coverage — 30 points, proportional to terms used.
  if (coverage.length > 0) {
    const used = coverage.filter((c) => c.used).length;
    const pct = Math.round((used / coverage.length) * 100);
    reasons.push({
      label: "Topic coverage",
      detail: `uses ${String(used)} of ${String(coverage.length)} terms the ranking pages share (${String(pct)}%)`,
      points: Math.round((used / coverage.length) * 30),
    });
  }

  // 4. Structure — 15 points.
  const h2s = page.headings.filter((h) => h.level === 2).length;
  if (h2s >= 5) {
    reasons.push({
      label: "Well structured",
      detail: `${String(h2s)} H2 sections`,
      points: 10,
    });
  } else if (h2s >= 2) {
    reasons.push({
      label: "Some structure",
      detail: `${String(h2s)} H2 sections`,
      points: 6,
    });
  } else {
    reasons.push({
      label: "Little structure",
      detail: `${String(h2s)} H2 headings — readers and Google both prefer sections`,
      points: 0,
    });
  }
  if (page.images >= 3) {
    reasons.push({
      label: "Illustrated",
      detail: `${String(page.images)} images`,
      points: 5,
    });
  }

  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  return { score: Math.min(100, Math.max(0, score)), reasons };
}

/**
 * The sections most ranking pages devote space to.
 *
 * Competitors never phrase a heading identically — "Choose a blogging
 * platform", "Pick your platform" and "Choose the right blogging platform" are
 * one section written three ways. So topics are found by the phrases that
 * recur *inside* headings, and each is then labelled with the shortest real
 * heading that used it, which reads like a heading rather than a keyword.
 */
function sharedHeadings(pages: PageContent[]): { text: string; count: number }[] {
  const perPage = pages.map((p) => p.headings.map((h) => h.text).join(" . "));
  const all = pages.flatMap((p) => p.headings.map((h) => h.text));

  const phrases = [
    ...extractTerms(perPage, 3, 15),
    ...extractTerms(perPage, 2, 30),
  ].sort((a, b) => b.documents - a.documents || b.count - a.count);

  const out: { text: string; count: number }[] = [];
  const used = new Set<string>();

  for (const phrase of phrases) {
    if (phrase.documents < 2) continue;

    // The shortest heading containing the phrase makes the cleanest label.
    const label = all
      .filter((h) => tokenize(h).join(" ").includes(phrase.term))
      .sort((a, b) => a.length - b.length)[0];

    if (label === undefined || used.has(label)) continue;

    used.add(label);
    out.push({ text: label, count: phrase.documents });
    if (out.length >= 18) break;
  }

  return out;
}

/**
 * The ranked checklist the editor works through.
 *
 * Merges recurring phrases and named entities into one list, scores each by
 * importance, and drops anything already contained in a stronger phrase — so
 * "domain" doesn't sit beside "domain name" as a separate task.
 */
function buildTargets(
  terms: Brief["terms"],
  entities: TermCount[],
  pages: PageContent[],
): TargetTerm[] {
  const totalDocuments = pages.length;

  // Anything a competitor put in a title or heading is a section, not a word.
  const headingText = pages
    .map((p) =>
      tokenize(
        `${p.title} ${p.h1} ${p.headings.map((h) => h.text).join(" ")}`,
      ).join(" "),
    )
    .join(" | ");

  const seed: { t: TermCount; size: number }[] = [
    ...terms.triple.map((t) => ({ t, size: 3 })),
    ...terms.double.map((t) => ({ t, size: 2 })),
    ...terms.single.map((t) => ({ t, size: 1 })),
    ...entities.map((t) => ({ t, size: tokenize(t.term).length || 1 })),
  ];

  const byTerm = new Map<string, TargetTerm>();

  for (const { t, size } of seed) {
    const term = t.term.toLowerCase().trim();
    if (term === "" || byTerm.has(term)) continue;

    const inHeadings = headingText.includes(term);

    byTerm.set(term, {
      term,
      documents: t.documents,
      count: t.count,
      size,
      inHeadings,
      weight: weighTerm({
        documents: t.documents,
        count: t.count,
        size,
        inHeadings,
        totalDocuments,
      }),
      suggestedUses: Math.max(
        1,
        Math.round(t.documents === 0 ? 1 : t.count / t.documents),
      ),
    });
  }

  const all = [...byTerm.values()].sort((a, b) => b.weight - a.weight);

  // Drop single words that only exist inside a phrase already on the list —
  // covering "blogging platform" inevitably covers "platform".
  const phrases = all.filter((t) => t.size > 1).map((t) => t.term);
  const kept = all.filter(
    (t) => t.size > 1 || !phrases.some((p) => p.split(" ").includes(t.term)),
  );

  return kept.slice(0, 60);
}

/** Words that recur across the ranking pages' own titles and H1s. */
function commonTitleWords(pages: PageContent[]): string[] {
  const counts = new Map<string, number>();

  for (const page of pages) {
    for (const word of new Set(tokenize(`${page.title} ${page.h1}`))) {
      if (word.length < 3) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);
}

export async function buildBrief(
  keyword: string,
  country: string,
  targetUrl?: string,
): Promise<Brief> {
  /*
   * One SERP fetch for the brief. Drafter prefers DataForSEO; SerpApi is only
   * the fallback. Depth 15 covers title-term extraction for the optimizer.
   */
  let serpSnapshot: NormalizedSerp | null = null;
  try {
    serpSnapshot = await getNormalizedSerp({
      keyword,
      country,
      language: "en",
      depth: 15,
      preferProvider: "dataforseo",
    });
  } catch {
    serpSnapshot = null;
  }

  const estimated = await hydrateKeyword(
    keyword,
    country,
  );
  if (serpSnapshot?.totalResults) {
    estimated.results = serpSnapshot.totalResults;
  }

  if (serpSnapshot && serpSnapshot.organicResults.length > 0) {
    const composition = difficultyFromSerpComposition(
      serpSnapshot.organicResults.map((r) => ({
        domain: r.domain,
        title: r.title,
        url: r.url,
      })),
      keyword,
      serpSnapshot.totalResults,
    );
    estimated.difficulty = composition.score;
  }

  const urls = (serpSnapshot?.organicResults ?? [])
    .map((r) => r.url)
    .filter((u) => u !== "")
    .slice(0, MAX_PAGES);

  const [pages, target] = await Promise.all([
    Promise.all(urls.map(readPage)),
    targetUrl !== undefined && targetUrl !== ""
      ? readPage(targetUrl)
      : Promise.resolve(null),
  ]);

  const analysed = pages.filter((p) => p.ok);
  const skipped = pages.filter((p) => !p.ok).map((p) => p.domain);

  const bodies = analysed.map((p) => p.text);
  const words = analysed.map((p) => p.words).filter((w) => w > 0);

  const headings = sharedHeadings(analysed);

  const terms = {
    single: extractTerms(bodies, 1, 25),
    double: extractTerms(bodies, 2, 25),
    triple: extractTerms(bodies, 3, 20),
  };

  const entities = extractEntities(bodies, 18);

  // Prefer live PAA; fall back to questions mined from competitor pages.
  const paa = serpSnapshot?.paa ?? [];
  const mined = extractQuestions(
    [...bodies, ...analysed.flatMap((p) => p.headings.map((h) => h.text))],
    14,
  );
  const questions = [...new Set([...paa, ...mined])].slice(0, 14);

  // Title words: SERP titles first (works even when crawls are blocked).
  const serpTitleWords = commonTitleWords(
    (serpSnapshot?.organicResults ?? []).map((r) => ({
      title: r.title,
      h1: "",
      headings: [],
      text: "",
      words: 0,
      images: 0,
      links: 0,
      url: r.url,
      domain: r.domain,
      metaDescription: "",
      ok: true,
    })),
  );
  const crawledTitleWords = commonTitleWords(analysed);
  const titleWords = [
    ...new Set([...serpTitleWords, ...crawledTitleWords]),
  ].slice(0, 12);

  const brief: Brief = {
    keyword,
    keywordMetrics: {
      difficulty: estimated.difficulty,
      volume: estimated.volume,
      cpc: estimated.cpc,
    },
    analysed,
    skipped,
    targetWords: {
      median: median(words),
      min: words.length > 0 ? Math.min(...words) : 0,
      max: words.length > 0 ? Math.max(...words) : 0,
    },
    headings,
    terms,
    entities,
    questions,
    targets: buildTargets(terms, entities, analysed),
    titleWords,
    serpSnapshot,
  };

  if (target) {
    const mine = tokenize(
      `${target.title} ${target.h1} ${target.headings.map((h) => h.text).join(" ")} ${target.text}`,
    );

    // Coverage is judged on the phrases most competitors share, weighted to
    // two- and three-word terms — single words are too generic to guide edits.
    const checkable = [
      ...terms.double.slice(0, 18),
      ...terms.triple.slice(0, 10),
      ...terms.single.slice(0, 12),
    ];

    const coverage: Coverage[] = checkable.map((t) => {
      const yours = countPhrase(mine, t.term);
      return {
        term: t.term,
        documents: t.documents,
        yours,
        used: yours > 0,
      };
    });

    const { score, reasons } = scoreTarget(target, keyword, brief, coverage);

    brief.target = {
      page: target,
      score,
      reasons,
      coverage,
      missing: coverage
        .filter((c) => !c.used)
        .sort((a, b) => b.documents - a.documents),
    };
  }

  return brief;
}
