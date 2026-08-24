/**
 * Readability and prose-quality measures over a draft.
 *
 * Everything here is a count or a published formula applied to the actual
 * text — no model is asked to grade anything, and nothing is estimated. The
 * two heuristics that cannot be exact (syllables and passive voice) say so in
 * their own docs and are labelled as heuristics in the UI, because English
 * spelling makes both undecidable without a dictionary.
 */

export type Sentence = {
  text: string;
  words: number;
  /** Character offset of the sentence within the plain-text body. */
  start: number;
};

export type PassiveHit = {
  /** The matched span, e.g. "was baked". */
  text: string;
  start: number;
};

export type ReadabilityReport = {
  words: number;
  sentences: number;
  paragraphs: number;
  syllables: number;
  /** Flesch Reading Ease, 0–100. Null when there is too little prose. */
  flesch: number | null;
  /** Plain-English band for the score. */
  grade: string;
  avgWordsPerSentence: number;
  avgSentencesPerParagraph: number;
  /** Sentences longer than LONG_SENTENCE words. */
  longSentences: Sentence[];
  /** Paragraphs with more than MAX_PARAGRAPH_SENTENCES sentences. */
  longParagraphs: { index: number; sentences: number; preview: string }[];
  passive: PassiveHit[];
  /** Share of sentences containing a passive construction, 0–100. */
  passivePercent: number;
};

/** Past this, a sentence is hard to hold in one breath on a phone. */
export const LONG_SENTENCE = 25;

/**
 * Measured across the six most recent published posts, paragraphs average 2.2
 * sentences. Three is the ceiling the drafter's tightener already enforces.
 */
export const MAX_PARAGRAPH_SENTENCES = 3;

/** Not enough prose to say anything meaningful about. */
const MIN_WORDS = 80;

/** Below this a "sentence" is a metadata stub, not prose. */
const MIN_SENTENCE_WORDS = 2;

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Block-level text runs, so paragraph counts survive the tag stripping. */
export function paragraphsOf(html: string): string[] {
  return html
    .split(/<\/(?:p|h[1-6]|li|blockquote|td|th)>/i)
    .map((chunk) => stripHtml(chunk))
    .filter((t) => t !== "");
}

/**
 * Sentence split that survives recipe prose.
 *
 * Requires a capital or digit to start the next sentence, so "350°F (175°C).
 * Bake" splits but "1.5 cups" and "Dr. Smith" do not.
 */
export function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  const parts = text.split(/(?<=[.!?])\s+(?=["“'(]?[A-Z0-9])/);
  let cursor = 0;
  for (const raw of parts) {
    const trimmed = raw.trim();
    const start = text.indexOf(trimmed, cursor);
    cursor = start === -1 ? cursor : start + trimmed.length;
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    /*
     * Single words are metadata stubs ("Yield:", "Notes") rather than prose.
     * The floor stops there: "You will love it." is a real sentence, and
     * discarding short ones inflates words-per-sentence and skews Flesch in
     * exactly the direction that flatters a draft.
     */
    if (words < MIN_SENTENCE_WORDS) continue;
    out.push({ text: trimmed, words, start: start === -1 ? cursor : start });
  }
  return out;
}

/**
 * Syllables in an English word.
 *
 * A heuristic: count vowel groups, drop a silent trailing "e", and never
 * return less than one. Exact syllabification needs a pronunciation
 * dictionary, so this is wrong on a small share of words — which is why the
 * Flesch score it feeds is shown as a band rather than a precise figure.
 */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w === "") return 0;
  if (w.length <= 3) return 1;

  const trimmed = w
    // Silent e: "bake" is one syllable, but "the" and "be" are handled above.
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");

  /*
   * One syllable per *run* of vowels, however long. Capping the run at two
   * letters splits "-ious" into "io" + "u" and scores "delicious" as four
   * syllables, which inflates every Flesch score built on it.
   */
  const groups = trimmed.match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 1);
}

/**
 * Forms of "to be" that can head a passive construction.
 *
 * "Being" and "been" are included; "having" is not, because "having baked" is
 * active.
 */
const BE_FORMS = new Set([
  "am", "is", "are", "was", "were", "be", "been", "being",
  "get", "gets", "got", "gotten",
]);

/**
 * Irregular past participles, which no suffix rule catches.
 *
 * Not exhaustive — English has a long tail — so this under-reports rather
 * than over-reports. A missed passive is a smaller failure than flagging an
 * active sentence as passive and sending the writer to rewrite good prose.
 */
const IRREGULAR_PARTICIPLES = new Set([
  "beaten", "become", "begun", "bent", "blown", "broken", "brought", "built",
  "burnt", "bought", "caught", "chosen", "come", "cut", "done", "drawn",
  "driven", "drunk", "eaten", "fallen", "fed", "felt", "finished", "flown",
  "forgotten", "found", "frozen", "given", "gone", "grown", "held", "hidden",
  "hit", "hurt", "kept", "known", "laid", "led", "left", "lent", "let", "lost",
  "made", "meant", "met", "paid", "put", "read", "ridden", "risen", "run",
  "said", "seen", "sold", "sent", "set", "shaken", "shown", "shut", "sung",
  "sat", "slept", "sliced", "sold", "spent", "spread", "stirred", "stolen",
  "stuck", "swollen", "taken", "taught", "thrown", "told", "torn", "understood",
  "woken", "worn", "won", "written",
]);

function isParticiple(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w === "") return false;
  if (IRREGULAR_PARTICIPLES.has(w)) return true;
  // Regular participles end in -ed. "-ing" never does.
  return w.endsWith("ed") && w.length > 3;
}

/**
 * Passive constructions: a form of "to be" followed by a past participle,
 * optionally with one adverb between them ("was gently folded").
 */
export function passiveHits(text: string): PassiveHit[] {
  const out: PassiveHit[] = [];
  const wordRe = /[A-Za-z'’-]+/g;
  const tokens: { word: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(text)) !== null) {
    tokens.push({ word: m[0], start: m.index });
  }

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const head = tokens[i]!;
    if (!BE_FORMS.has(head.word.toLowerCase())) continue;

    const next = tokens[i + 1]!;
    if (isParticiple(next.word)) {
      out.push({
        text: `${head.word} ${next.word}`,
        start: head.start,
      });
      continue;
    }

    // One adverb may sit between the auxiliary and the participle.
    const after = tokens[i + 2];
    if (
      after !== undefined &&
      next.word.toLowerCase().endsWith("ly") &&
      isParticiple(after.word)
    ) {
      out.push({
        text: `${head.word} ${next.word} ${after.word}`,
        start: head.start,
      });
    }
  }

  return out;
}

/** Flesch's own bands, so the number is readable without looking it up. */
export function fleschGrade(score: number): string {
  if (score >= 90) return "Very easy";
  if (score >= 80) return "Easy";
  if (score >= 70) return "Fairly easy";
  if (score >= 60) return "Plain English";
  if (score >= 50) return "Fairly difficult";
  if (score >= 30) return "Difficult";
  return "Very difficult";
}

export function analyseReadability(html: string): ReadabilityReport {
  const paragraphs = paragraphsOf(html);
  const text = stripHtml(html);
  const sentences = sentencesOf(text);
  const wordList = text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  const words = wordList.length;
  const syllableCount = wordList.reduce((n, w) => n + syllables(w), 0);

  const flesch =
    words < MIN_WORDS || sentences.length === 0
      ? null
      : Math.round(
          (206.835 -
            1.015 * (words / sentences.length) -
            84.6 * (syllableCount / words)) *
            10,
        ) / 10;

  const longParagraphs = paragraphs
    .map((p, index) => ({ index, p, sentences: sentencesOf(p).length }))
    .filter((r) => r.sentences > MAX_PARAGRAPH_SENTENCES)
    .map((r) => ({
      index: r.index,
      sentences: r.sentences,
      preview: r.p.slice(0, 90),
    }));

  const passive = passiveHits(text);
  const passiveSentences = sentences.filter((s) =>
    passiveHits(s.text).length > 0,
  ).length;

  return {
    words,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    syllables: syllableCount,
    flesch,
    grade: flesch === null ? "—" : fleschGrade(flesch),
    avgWordsPerSentence:
      sentences.length === 0
        ? 0
        : Math.round((words / sentences.length) * 10) / 10,
    avgSentencesPerParagraph:
      paragraphs.length === 0
        ? 0
        : Math.round((sentences.length / paragraphs.length) * 10) / 10,
    longSentences: sentences.filter((s) => s.words > LONG_SENTENCE),
    longParagraphs,
    passive,
    passivePercent:
      sentences.length === 0
        ? 0
        : Math.round((passiveSentences / sentences.length) * 100),
  };
}
