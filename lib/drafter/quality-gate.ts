import { stripHtml } from "@/lib/drafter/readability";

/**
 * Server-side check that a draft is actually written.
 *
 * The failure this exists to catch is specific and was live in production: a
 * new Drafter article was seeded with the section skeleton, so it opened
 * looking like a finished post whose every paragraph happened to be an
 * instruction. Nothing downstream could tell that apart from prose, so it
 * exported, and the author reported "the Drafter writes placeholders".
 *
 * Regex alone is not enough — a model can produce something with no forbidden
 * token in it that is still a list of headings with nothing underneath. So
 * this measures the prose as well as scanning it.
 */

/** Tokens that are never acceptable in a finished draft. */
const PLACEHOLDER_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "square-bracket instruction", re: /\[(?:insert|write|add|your|section|paragraph|todo|tbd)[^\]]*\]/i },
  { label: "handlebars token", re: /\{\{[^}]+\}\}/ },
  { label: "angle-bracket placeholder", re: /<placeholder\b|<insert\b/i },
  { label: "TODO / TBD", re: /\b(?:TODO|TBD)\b/ },
  { label: "lorem ipsum", re: /\blorem ipsum\b/i },
  { label: "instruction phrase", re: /\b(?:insert (?:here|paragraph|content|text)|add (?:content|paragraph|a paragraph) here|section goes here|write (?:the |a )?(?:section|paragraph|intro) here|content goes here|coming soon)\b/i },
  { label: "unresolved AI marker", re: /\b(?:as an AI language model|Sure, here(?:'s| is))\b/i },
  { label: "pipeline delimiter", re: /<<<[^>]*>>>/ },
  /*
   * Markdown image syntax reaching the editor is a placeholder by definition:
   * the converter turns real images into <img>, so anything still written as
   * an image reference is a caption for a picture that does not exist. Seen
   * live as "![Image of kabocha squash soup]".
   */
  { label: "markdown image placeholder", re: /!\[[^\]]*\]/ },
];

/**
 * Sentences the built-in skeleton writes.
 *
 * Matched on letters and digits only, because the editor rewrites punctuation
 * on the way through — the em dash in "Hook — three or four sentences" comes
 * back as a hyphen. Kept as a distinct signal from the generic patterns above
 * so the reason given to the author names the real problem.
 */
const SKELETON_PROMPTS = [
  "hook three or four sentences no heading above this",
  "lead photo goes here",
  "the rest of the intro the story why this version who it is for",
  "ingredients photo",
  "what happens in this step in one or two sentences",
  "real variants only delete this section if the recipe has none",
  "plating pairings what to do with leftovers",
  "pitfalls only things that actually go wrong",
  "enter the answer to the question",
  "four related recipes the site renders these as a card grid",
  "reason two",
  "reason three",
  "what the testers said",
];

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Prose that is not a heading, so a wall of H2s cannot pass as an article. */
function bodyProse(html: string): string {
  return stripHtml(html.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, " "));
}

export type QualityIssue = {
  code:
    | "empty"
    | "headings-only"
    | "too-short"
    | "skeleton-prompts"
    | "placeholder-tokens"
    | "thin-sections"
    | "no-sections";
  message: string;
  /** Offending fragments, for the diagnostic panel. Never the whole draft. */
  samples?: string[];
};

export type QualityReport = {
  ok: boolean;
  issues: QualityIssue[];
  stats: {
    words: number;
    proseWords: number;
    headings: number;
    paragraphs: number;
    skeletonHits: number;
  };
};

/** Under this, there is no article regardless of what the tokens say. */
const MIN_PROSE_WORDS = 250;

/** A section with fewer words than this has a heading and nothing under it. */
const MIN_WORDS_PER_HEADING = 12;

/**
 * A finished post is sectioned.
 *
 * Caught on a live run: the model returned 805 words of unbroken intro and no
 * headings at all. Every token check passed, because the prose was real — but
 * there was nothing for the WordPress template mapper to work with, since it
 * maps by H2. Prose without structure is not a draft of this post.
 */
const MIN_SECTIONS = 4;

export function checkDraftQuality(html: string): QualityReport {
  const issues: QualityIssue[] = [];

  const headings = [...html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)];
  const prose = bodyProse(html);
  const proseWords = prose.split(/\s+/).filter(Boolean).length;
  const allWords = stripHtml(html).split(/\s+/).filter(Boolean).length;
  const paragraphs = (html.match(/<p\b/gi) ?? []).length;

  const folded = fold(prose);
  const skeletonHits = SKELETON_PROMPTS.filter((p) => folded.includes(p));

  if (allWords === 0) {
    issues.push({ code: "empty", message: "The draft is empty." });
    return {
      ok: false,
      issues,
      stats: { words: 0, proseWords: 0, headings: headings.length, paragraphs, skeletonHits: 0 },
    };
  }

  if (proseWords === 0 && headings.length > 0) {
    issues.push({
      code: "headings-only",
      message: "The draft is only headings — no section has been written yet.",
    });
  }

  if (skeletonHits.length > 0) {
    issues.push({
      code: "skeleton-prompts",
      message:
        skeletonHits.length === 1
          ? "One section still holds its template prompt instead of prose."
          : `${String(skeletonHits.length)} sections still hold their template prompts instead of prose.`,
      samples: skeletonHits.slice(0, 5),
    });
  }

  const haystack = `${html}\n${prose}`;
  const tokenHits = PLACEHOLDER_PATTERNS.filter((p) => p.re.test(haystack));
  if (tokenHits.length > 0) {
    issues.push({
      code: "placeholder-tokens",
      message: "The draft contains placeholder text that must not be published.",
      samples: tokenHits.map((t) => t.label),
    });
  }

  if (headings.length < MIN_SECTIONS && proseWords > 0) {
    issues.push({
      code: "no-sections",
      message:
        headings.length === 0
          ? "The draft has no section headings, so nothing can be mapped into the WordPress template."
          : `Only ${String(headings.length)} section headings — a finished post has at least ${String(MIN_SECTIONS)}.`,
    });
  }

  if (proseWords > 0 && proseWords < MIN_PROSE_WORDS) {
    issues.push({
      code: "too-short",
      message: `Only ${String(proseWords)} words of prose — a finished post runs well past ${String(MIN_PROSE_WORDS)}.`,
    });
  }

  /*
   * Headings with nothing under them. Counted rather than spotted: a draft can
   * have plenty of words overall and still leave half its sections bare, which
   * is exactly what a half-finished generation looks like.
   */
  if (headings.length >= 3) {
    let bare = 0;
    headings.forEach((m, i) => {
      const from = (m.index ?? 0) + m[0].length;
      const to = headings[i + 1]?.index ?? html.length;
      const words = bodyProse(html.slice(from, to)).split(/\s+/).filter(Boolean).length;
      if (words < MIN_WORDS_PER_HEADING) bare += 1;
    });
    if (bare > headings.length / 3) {
      issues.push({
        code: "thin-sections",
        message: `${String(bare)} of ${String(headings.length)} sections have little or no text under them.`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      words: allWords,
      proseWords,
      headings: headings.length,
      paragraphs,
      skeletonHits: skeletonHits.length,
    },
  };
}
