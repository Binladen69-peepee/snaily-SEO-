import { tokenize, wordCount } from "@/lib/text";

/**
 * Live scoring for the Content Optimizer.
 *
 * Deliberately free of server imports (no cheerio, no Prisma) so the editor
 * can re-run the whole analysis on every keystroke in the browser. The server
 * gathers the brief once; everything in this file is pure and instant.
 *
 * Every score is the plain sum of the reasons returned beside it. Nothing here
 * is a model, and nothing is hidden.
 */

/** Google truncates around here, so these are the practical title limits. */
export const TITLE_MIN = 30;
export const TITLE_IDEAL_MIN = 45;
export const TITLE_IDEAL_MAX = 60;
export const TITLE_MAX = 65;

export type TargetTerm = {
  term: string;
  /** How many of the ranking pages use it. */
  documents: number;
  /** Total uses across those pages. */
  count: number;
  /** Words in the phrase — 1, 2 or 3. */
  size: number;
  /** True when competitors put it in a title or heading. */
  inHeadings: boolean;
  /** 0–100. Higher means it matters more. */
  weight: number;
  /** How many times competitors typically use it in one article. */
  suggestedUses: number;
};

export type TermStatus = TargetTerm & {
  /** Times the phrase appears in the draft. */
  used: number;
  /** True once the draft uses it at all. */
  done: boolean;
};

export type ScoreReason = { label: string; detail: string; points: number };

/**
 * Ranks a term by how much it matters for this topic.
 *
 * Weighted so the list reads top-down as "do this first":
 *  - agreement across competitors is the strongest signal (up to 55)
 *  - appearing in their headings means it is a section, not a passing word (20)
 *  - multi-word phrases are more actionable than single words (up to 15)
 *  - sheer repetition breaks ties (up to 10)
 */
export function weighTerm(input: {
  documents: number;
  count: number;
  size: number;
  inHeadings: boolean;
  totalDocuments: number;
}): number {
  const { documents, count, size, inHeadings, totalDocuments } = input;

  const agreement = totalDocuments === 0 ? 0 : documents / totalDocuments;
  let weight = Math.round(agreement * 55);

  if (inHeadings) weight += 20;
  weight += size === 3 ? 15 : size === 2 ? 11 : 4;

  const perDoc = documents === 0 ? 0 : count / documents;
  weight += Math.min(10, Math.round(perDoc));

  return Math.max(1, Math.min(100, weight));
}

/** Counts non-overlapping occurrences of a phrase in tokenized text. */
export function countPhrase(haystack: string[], phrase: string): number {
  const words = phrase.split(" ");
  if (words.length === 0) return 0;

  let hits = 0;
  for (let i = 0; i + words.length <= haystack.length; i++) {
    let match = true;
    for (let j = 0; j < words.length; j++) {
      if (haystack[i + j] !== words[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      hits++;
      i += words.length - 1; // don't count overlaps twice
    }
  }
  return hits;
}

/**
 * Re-checks every target term against the current draft.
 *
 * Runs on each keystroke. The draft is tokenized once and every term is a
 * linear scan, so a 3,000-word article against 60 terms is well under a frame.
 */
export function checkTerms(draft: string, terms: TargetTerm[]): TermStatus[] {
  const tokens = tokenize(draft);
  return terms.map((t) => {
    const used = countPhrase(tokens, t.term);
    return { ...t, used, done: used > 0 };
  });
}

export type DraftScore = {
  score: number;
  reasons: ScoreReason[];
  words: number;
  covered: number;
  total: number;
};

/**
 * Grades the draft against the brief. Sum of the reasons, capped at 100.
 */
export function scoreDraft(
  draft: string,
  statuses: TermStatus[],
  targetWords: number,
): DraftScore {
  const reasons: ScoreReason[] = [];
  const words = wordCount(draft);

  // 1. Length against what already ranks — 30 points.
  if (targetWords > 0) {
    const ratio = words / targetWords;
    if (ratio >= 0.9) {
      reasons.push({
        label: "Length matches the ranking pages",
        detail: `${words.toLocaleString("en-US")} words vs a median of ${targetWords.toLocaleString("en-US")}`,
        points: 30,
      });
    } else if (ratio >= 0.6) {
      reasons.push({
        label: "Slightly short",
        detail: `${words.toLocaleString("en-US")} of about ${targetWords.toLocaleString("en-US")} words`,
        points: 18,
      });
    } else if (ratio >= 0.3) {
      reasons.push({
        label: "Well under the ranking pages",
        detail: `${words.toLocaleString("en-US")} of about ${targetWords.toLocaleString("en-US")} words`,
        points: 8,
      });
    } else {
      reasons.push({
        label: words === 0 ? "Nothing written yet" : "Far too short",
        detail: `${words.toLocaleString("en-US")} of about ${targetWords.toLocaleString("en-US")} words`,
        points: 0,
      });
    }
  }

  // 2. Coverage, weighted by importance — 55 points.
  const totalWeight = statuses.reduce((s, t) => s + t.weight, 0);
  const doneWeight = statuses
    .filter((t) => t.done)
    .reduce((s, t) => s + t.weight, 0);
  const covered = statuses.filter((t) => t.done).length;

  if (totalWeight > 0) {
    const share = doneWeight / totalWeight;
    reasons.push({
      label: "Topic coverage",
      detail: `${String(covered)} of ${String(statuses.length)} terms used, weighted by importance (${String(Math.round(share * 100))}%)`,
      points: Math.round(share * 55),
    });
  }

  // 3. The heavyweight terms specifically — 15 points.
  const critical = statuses.filter((t) => t.weight >= 60);
  if (critical.length > 0) {
    const hit = critical.filter((t) => t.done).length;
    reasons.push({
      label: "High-importance terms",
      detail: `${String(hit)} of ${String(critical.length)} of the most important phrases are in`,
      points: Math.round((hit / critical.length) * 15),
    });
  }

  const score = reasons.reduce((s, r) => s + r.points, 0);

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons,
    words,
    covered,
    total: statuses.length,
  };
}

export type TitleAnalysis = {
  score: number;
  reasons: ScoreReason[];
  length: number;
  /** "short" | "ok" | "long" — drives the warning shown under the field. */
  lengthState: "empty" | "short" | "ok" | "long";
  /** Important words competitors use in titles that this one is missing. */
  missingWords: string[];
  /** Concrete additions, highest value first. */
  suggestions: string[];
};

/**
 * RankIQ-style title grading.
 *
 * Scored on the four things that actually decide whether a title earns the
 * click and signals the topic: the keyword being present and early, a length
 * that survives truncation, the words competitors agree on, and a hook.
 */
export function analyseTitle(
  title: string,
  keyword: string,
  /** Words competitors use in their own titles, most common first. */
  titleWords: string[],
  terms: TargetTerm[],
): TitleAnalysis {
  const trimmed = title.trim();
  const length = trimmed.length;
  const reasons: ScoreReason[] = [];

  if (length === 0) {
    return {
      score: 0,
      reasons: [
        { label: "No title yet", detail: "write one to grade it", points: 0 },
      ],
      length: 0,
      lengthState: "empty",
      missingWords: titleWords.slice(0, 8),
      suggestions: [],
    };
  }

  const tokens = tokenize(trimmed);
  const lower = trimmed.toLowerCase();
  const kw = keyword.trim().toLowerCase();

  // 1. The target keyword, and how early it lands — 40 points.
  const kwTokens = tokenize(kw);
  const kwAt = kwTokens.length > 0 ? findPhrase(tokens, kwTokens) : -1;

  if (kwAt === 0) {
    reasons.push({
      label: "Starts with the target keyword",
      detail: "the strongest possible placement",
      points: 40,
    });
  } else if (kwAt > 0 && kwAt <= 3) {
    reasons.push({
      label: "Target keyword near the start",
      detail: `begins at word ${String(kwAt + 1)}`,
      points: 32,
    });
  } else if (kwAt > 3) {
    reasons.push({
      label: "Target keyword present, but late",
      detail: `begins at word ${String(kwAt + 1)} — move it earlier`,
      points: 22,
    });
  } else {
    reasons.push({
      label: "Target keyword missing",
      detail: `"${keyword}" does not appear in the title`,
      points: 0,
    });
  }

  // 2. Length — 25 points.
  let lengthState: TitleAnalysis["lengthState"];
  if (length < TITLE_MIN) {
    lengthState = "short";
    reasons.push({
      label: "Title is too short",
      detail: `${String(length)} characters — aim for ${String(TITLE_IDEAL_MIN)}–${String(TITLE_IDEAL_MAX)}`,
      points: 6,
    });
  } else if (length > TITLE_MAX) {
    lengthState = "long";
    reasons.push({
      label: "Title will be cut off",
      detail: `${String(length)} characters — Google truncates past about ${String(TITLE_IDEAL_MAX)}`,
      points: 8,
    });
  } else if (length >= TITLE_IDEAL_MIN && length <= TITLE_IDEAL_MAX) {
    lengthState = "ok";
    reasons.push({
      label: "Length is ideal",
      detail: `${String(length)} characters fits without truncation`,
      points: 25,
    });
  } else {
    lengthState = "ok";
    reasons.push({
      label: "Length is usable",
      detail: `${String(length)} characters — ${String(TITLE_IDEAL_MIN)}–${String(TITLE_IDEAL_MAX)} is the sweet spot`,
      points: 18,
    });
  }

  // 3. Words the ranking titles agree on — 20 points.
  const present = new Set(tokens);
  const missingWords = titleWords.filter((w) => !present.has(w)).slice(0, 10);
  const matched = titleWords.filter((w) => present.has(w)).length;

  if (titleWords.length > 0) {
    reasons.push({
      label: "Words the ranking titles share",
      detail:
        matched === 0
          ? "none of them yet"
          : `uses ${String(matched)} of ${String(titleWords.length)}`,
      points: Math.round((matched / titleWords.length) * 20),
    });
  }

  // 4. A hook — a number or a bracketed qualifier — 15 points.
  const hasNumber = /\d/.test(trimmed);
  const hasQualifier = /[([]|:|\||—|-\s/.test(trimmed);

  if (hasNumber && hasQualifier) {
    reasons.push({
      label: "Strong hook",
      detail: "has both a number and a qualifier",
      points: 15,
    });
  } else if (hasNumber) {
    reasons.push({
      label: "Contains a number",
      detail: "numbered titles earn more clicks",
      points: 10,
    });
  } else if (hasQualifier) {
    reasons.push({
      label: "Has a qualifier",
      detail: "a colon, dash or bracket adds specificity",
      points: 7,
    });
  } else {
    reasons.push({
      label: "No hook",
      detail: "a number or a qualifier like “(2026 Guide)” lifts click-through",
      points: 0,
    });
  }

  const suggestions = buildSuggestions({
    hasKeyword: kwAt >= 0,
    keyword,
    lengthState,
    hasNumber,
    hasQualifier,
    missingWords,
    terms,
    lower,
  });

  return {
    score: Math.max(
      0,
      Math.min(
        100,
        reasons.reduce((s, r) => s + r.points, 0),
      ),
    ),
    reasons,
    length,
    lengthState,
    missingWords,
    suggestions,
  };
}

/** Index of the first token where `phrase` starts, or -1. */
function findPhrase(tokens: string[], phrase: string[]): number {
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    let match = true;
    for (let j = 0; j < phrase.length; j++) {
      if (tokens[i + j] !== phrase[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function buildSuggestions(input: {
  hasKeyword: boolean;
  keyword: string;
  lengthState: TitleAnalysis["lengthState"];
  hasNumber: boolean;
  hasQualifier: boolean;
  missingWords: string[];
  terms: TargetTerm[];
  lower: string;
}): string[] {
  const out: string[] = [];

  if (!input.hasKeyword && input.keyword.trim() !== "") {
    out.push(`Add “${input.keyword.trim()}” — ideally as the opening words`);
  }
  if (input.lengthState === "short") {
    out.push(
      `Lengthen to ${String(TITLE_IDEAL_MIN)}–${String(TITLE_IDEAL_MAX)} characters so it fills the SERP line`,
    );
  }
  if (input.lengthState === "long") {
    out.push(
      `Trim to ${String(TITLE_IDEAL_MAX)} characters or fewer so it isn't cut off`,
    );
  }
  if (!input.hasNumber) {
    out.push("Add a number, e.g. “7 Steps” or the current year");
  }
  if (!input.hasQualifier) {
    out.push("Add a qualifier after a colon or dash, e.g. “: A Beginner's Guide”");
  }

  for (const word of input.missingWords.slice(0, 4)) {
    out.push(`Work in “${word}” — the ranking titles use it`);
  }

  // Fall back to the heaviest phrase the title doesn't mention.
  const heavy = input.terms
    .filter((t) => t.size > 1 && !input.lower.includes(t.term))
    .sort((a, b) => b.weight - a.weight)[0];
  if (heavy) {
    out.push(`Consider the phrase “${heavy.term}” — the strongest topic signal`);
  }

  return out.slice(0, 6);
}

/* -------------------------------------------------------------------------
 * Content Optimization Score
 * ---------------------------------------------------------------------- */

/**
 * Weighted coverage at which the article counts as fully optimised.
 *
 * The client's rule: covering roughly three quarters of the important terms
 * should read as 100%. Chasing the last quarter is diminishing returns and
 * pushes writers into keyword stuffing, so the scale tops out early.
 */
export const FULL_COVERAGE_AT = 0.75;

export type OptimizationScore = {
  /** 0–100, shown at the top of the editor. */
  percent: number;
  /** Share of importance-weighted terms actually used, 0–1. */
  weightedCoverage: number;
  /** Terms used / terms tracked, for the caption. */
  used: number;
  total: number;
  /** True once the threshold is met. */
  complete: boolean;
  /** How many more high-importance terms would reach 100%. */
  remaining: number;
};

/**
 * Scores coverage on importance weight, not term count.
 *
 * Counting terms equally would let a writer hit 100% on trivia while missing
 * every phrase that matters. Weighting by importance means the score can only
 * be moved meaningfully by the terms the ranking pages actually agree on.
 */
export function optimizationScore(statuses: TermStatus[]): OptimizationScore {
  const total = statuses.length;
  const used = statuses.filter((t) => t.done).length;

  if (total === 0) {
    return {
      percent: 0,
      weightedCoverage: 0,
      used: 0,
      total: 0,
      complete: false,
      remaining: 0,
    };
  }

  const totalWeight = statuses.reduce((sum, t) => sum + t.weight, 0);
  const doneWeight = statuses
    .filter((t) => t.done)
    .reduce((sum, t) => sum + t.weight, 0);

  const weightedCoverage = totalWeight === 0 ? 0 : doneWeight / totalWeight;
  const percent = Math.round(
    Math.min(1, weightedCoverage / FULL_COVERAGE_AT) * 100,
  );

  // What is still needed, counted heaviest-first — that is the shortest route
  // to the threshold and the advice the writer actually wants.
  const targetWeight = totalWeight * FULL_COVERAGE_AT;
  let running = doneWeight;
  let remaining = 0;

  for (const t of statuses
    .filter((s) => !s.done)
    .sort((a, b) => b.weight - a.weight)) {
    if (running >= targetWeight) break;
    running += t.weight;
    remaining++;
  }

  return {
    percent,
    weightedCoverage,
    used,
    total,
    complete: percent >= 100,
    remaining,
  };
}
