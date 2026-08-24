/**
 * Measuring how a piece of writing actually behaves.
 *
 * "It still sounds like AI" is a true observation and an unactionable one. The
 * only way to close a voice gap is to find the parts of it that are countable,
 * so this reduces prose to numbers that can be compared between the client's
 * published posts and whatever the Drafter just produced.
 *
 * Nothing here judges quality. A metric says "your paragraphs average 3.4
 * sentences and theirs average 1.9" — what to do about that is the prompt's
 * job. Keeping the measuring honest and separate is what makes it possible to
 * tell whether a prompt change helped or just felt like it did.
 */

export type StyleMetrics = {
  words: number;
  sentences: number;
  paragraphs: number;

  /** Sentence rhythm. */
  meanSentenceWords: number;
  medianSentenceWords: number;
  sentenceWordsStdev: number;
  /** Share of sentences under 8 words — fragments and punch lines. */
  shortSentenceShare: number;
  /** Share over 28 words — the run-ons that read as machine-written. */
  longSentenceShare: number;

  /** Paragraph rhythm. */
  meanParagraphSentences: number;
  singleSentenceParagraphShare: number;
  longParagraphShare: number;

  /** Per 1,000 words unless noted. */
  parentheticals: number;
  secondPerson: number;
  firstPerson: number;
  questions: number;
  exclamations: number;
  numerals: number;
  properNounRuns: number;
  slang: number;
  genericFoodAdjectives: number;
  adjectiveStacks: number;
  emDashes: number;

  /** Share of sentences opening with a determiner or "It" — sameness. */
  flatOpeningShare: number;
  /** Distinct sentence-opening words as a share of sentences. */
  openingVariety: number;
};

/* ---------------------------------------------------------------------------
 * Vocabulary the metrics count
 * ------------------------------------------------------------------------ */

/**
 * The adjectives a model reaches for when it has nothing specific to say.
 *
 * Two lists in the client's style guide overlap here — the outright banned
 * ones and the "almost never" ones — plus the words that are not banned but
 * appear in every generated draft and almost never in a published post.
 */
export const GENERIC_FOOD_ADJECTIVES = [
  "cozy",
  "cosy",
  "delicious",
  "silky",
  "velvety",
  "warm hug",
  "hearty",
  "comforting",
  "rich and",
  "perfectly",
  "beautifully",
  "wonderfully",
  "delightful",
  "flavorful",
  "flavourful",
  "mouthwatering",
  "decadent",
  "irresistible",
  "sumptuous",
  "luscious",
  "heavenly",
  "divine",
  "delectable",
  "savory goodness",
  "savoury goodness",
  "burst of flavor",
  "burst of flavour",
  "melt in your mouth",
  "melt-in-your-mouth",
  "crowd pleaser",
  "crowd-pleaser",
  "weeknight winner",
  "next level",
  "next-level",
  "cozy bowl",
  "warm hug",
  "feel good about the planet",
  "brightens the plate",
];

export const HOUSE_SLANG = [
  "nope",
  "slaps",
  "banger",
  "baller",
  "bad boy",
  "bad boyo",
  "delulu",
  "popping off",
  "friggin",
  "gosh darn",
  "dag nabbit",
  "darn tootin",
  "'em",
  "gotta",
  "poppin",
  "wanna",
  "fave",
  "favie",
  "kinda",
  "perfies",
  "ain't",
  "thicc",
  " af",
  "hella",
  "m'love",
  "m'heart",
  "for realsies",
  "stupidly",
  "absurdly",
  "ridiculously",
  "mega",
  "turnt",
  "unhinged",
];

/** Determiners that make a sentence opening feel like every other one. */
const FLAT_OPENERS = new Set([
  "the",
  "this",
  "these",
  "that",
  "it",
  "a",
  "an",
  "there",
  "you",
]);

/* ---------------------------------------------------------------------------
 * Extraction
 * ------------------------------------------------------------------------ */

/**
 * The prose of a post, with the furniture removed.
 *
 * Headings, recipe cards, lists and captions are all real content and none of
 * them are prose — measuring them drags every average toward the structure of
 * the template rather than the voice of the writer.
 */
export function proseParagraphs(html: string): string[] {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, "\n\n")
    .replace(/<figure\b[\s\S]*?<\/figure>/gi, " ")
    .replace(/<figcaption\b[\s\S]*?<\/figcaption>/gi, " ")
    .replace(/<table\b[\s\S]*?<\/table>/gi, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");

  const blocks = [...withoutBlocks.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(
    (m) => m[2] ?? "",
  );

  const source = blocks.length > 0 ? blocks : withoutBlocks.split(/\n{2,}/);

  return source
    .map((block) =>
      block
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&#\d+;/g, "'")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((text) => text.split(/\s+/).filter(Boolean).length >= 4);
}

function sentencesOf(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘])/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

const round = (n: number, places = 2) =>
  Math.round(n * 10 ** places) / 10 ** places;

function countAll(haystack: string, needles: string[]): number {
  let n = 0;
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      n += 1;
      from = at + needle.length;
    }
  }
  return n;
}

/* ---------------------------------------------------------------------------
 * The measurement
 * ------------------------------------------------------------------------ */

export function measureProse(html: string): StyleMetrics {
  const paragraphs = proseParagraphs(html);
  const text = paragraphs.join("\n\n");
  const lower = text.toLowerCase();
  const allWords = wordsOf(text);
  const words = allWords.length;
  const per1k = (n: number) => (words === 0 ? 0 : round((n / words) * 1_000));

  const sentenceLengths: number[] = [];
  const paragraphSentenceCounts: number[] = [];
  const openings: string[] = [];

  for (const paragraph of paragraphs) {
    const sentences = sentencesOf(paragraph);
    paragraphSentenceCounts.push(sentences.length);
    for (const sentence of sentences) {
      const n = wordsOf(sentence).length;
      if (n === 0) continue;
      sentenceLengths.push(n);
      const first = (/^[\w'’]+/.exec(sentence)?.[0] ?? "").toLowerCase();
      if (first !== "") openings.push(first);
    }
  }

  const sentences = sentenceLengths.length;
  const share = (n: number) => (sentences === 0 ? 0 : round(n / sentences, 3));

  /*
   * A run of capitalised words that is not at the start of a sentence. Stands
   * in for the named things the client's prose is full of — Beyoncé, the
   * Empire State Building, Trader Joe's, Freddy Krueger — which is most of
   * what makes it read as written by a person with opinions.
   */
  let properNounRuns = 0;
  for (const paragraph of paragraphs) {
    for (const sentence of sentencesOf(paragraph)) {
      const body = sentence.replace(/^[^\s]+\s/, "");
      properNounRuns += (body.match(/\b[A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)*/g) ?? []).length;
    }
  }

  const flat = openings.filter((w) => FLAT_OPENERS.has(w)).length;

  return {
    words,
    sentences,
    paragraphs: paragraphs.length,

    meanSentenceWords:
      sentences === 0
        ? 0
        : round(sentenceLengths.reduce((a, b) => a + b, 0) / sentences, 1),
    medianSentenceWords: median(sentenceLengths),
    sentenceWordsStdev: round(stdev(sentenceLengths), 1),
    shortSentenceShare: share(sentenceLengths.filter((n) => n < 8).length),
    longSentenceShare: share(sentenceLengths.filter((n) => n > 28).length),

    meanParagraphSentences:
      paragraphs.length === 0
        ? 0
        : round(
            paragraphSentenceCounts.reduce((a, b) => a + b, 0) / paragraphs.length,
            2,
          ),
    singleSentenceParagraphShare:
      paragraphs.length === 0
        ? 0
        : round(
            paragraphSentenceCounts.filter((n) => n === 1).length / paragraphs.length,
            3,
          ),
    longParagraphShare:
      paragraphs.length === 0
        ? 0
        : round(
            paragraphSentenceCounts.filter((n) => n > 4).length / paragraphs.length,
            3,
          ),

    parentheticals: per1k((text.match(/\([^)]{3,}\)/g) ?? []).length),
    secondPerson: per1k((lower.match(/\b(you|your|you'?ll|you'?re|you'?ve)\b/g) ?? []).length),
    firstPerson: per1k((lower.match(/\b(i|i'?m|i'?ve|i'?ll|my|me)\b/g) ?? []).length),
    questions: per1k((text.match(/\?/g) ?? []).length),
    exclamations: per1k((text.match(/!/g) ?? []).length),
    numerals: per1k((text.match(/\b\d+(?:[.,/]\d+)?\b/g) ?? []).length),
    properNounRuns: per1k(properNounRuns),
    slang: per1k(countAll(lower, HOUSE_SLANG)),
    genericFoodAdjectives: per1k(countAll(lower, GENERIC_FOOD_ADJECTIVES)),
    adjectiveStacks: per1k(
      (text.match(/\b\w+ly?\b,\s+\w+,\s+and\s+\w+\b/g) ?? []).length,
    ),
    emDashes: per1k((text.match(/[—–]/g) ?? []).length),

    flatOpeningShare: share(flat),
    openingVariety: share(new Set(openings).size),
  };
}

/** Averages a set of measurements, so a corpus reads as one profile. */
export function averageMetrics(all: StyleMetrics[]): StyleMetrics {
  if (all.length === 0) return measureProse("");

  const keys = Object.keys(all[0]!) as (keyof StyleMetrics)[];
  const out = {} as StyleMetrics;

  for (const key of keys) {
    const mean = all.reduce((sum, m) => sum + m[key], 0) / all.length;
    out[key] = round(mean, key === "words" || key === "sentences" ? 0 : 3);
  }
  return out;
}
