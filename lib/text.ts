/**
 * Plain text analysis shared by the Content Optimizer and competitor tools.
 *
 * No model and no external service — n-gram counting over text we already
 * fetched. That keeps it fast, free, and explainable: every term listed can be
 * traced back to the pages it was counted in.
 */

const STOPWORDS = new Set([
  "a","about","above","after","again","against","all","am","an","and","any","are","aren",
  "as","at","be","because","been","before","being","below","between","both","but","by",
  "can","cannot","could","couldn","did","didn","do","does","doesn","doing","don","down",
  "during","each","few","for","from","further","had","hadn","has","hasn","have","haven",
  "having","he","her","here","hers","herself","him","himself","his","how","i","if","in",
  "into","is","isn","it","its","itself","just","let","me","more","most","must","my",
  "myself","no","nor","not","now","of","off","on","once","only","or","other","ought",
  "our","ours","ourselves","out","over","own","re","same","shan","she","should","shouldn",
  "so","some","such","than","that","the","their","theirs","them","themselves","then",
  "there","these","they","this","those","through","to","too","under","until","up","ve",
  "very","was","wasn","we","were","weren","what","when","where","which","while","who",
  "whom","why","will","with","won","would","wouldn","you","your","yours","yourself",
  "yourselves","s","t","d","ll","m","o","y","also","get","got","one","two","use","using",
  "used","make","makes","like","need","want","best","top","new","see","may","much","many",
]);

/**
 * Marks a hard boundary between blocks of text.
 *
 * A list item, heading or paragraph ends a phrase. Flattening HTML with a bare
 * space let n-grams stride across those joins and glue unrelated fragments
 * together — "Greek yogurt</li><li>Olive oil" became "greek yogurt olive".
 * Callers insert this between blocks and no n-gram may cross it.
 */
export const SEGMENT_BREAK = String.fromCharCode(1);

export type TermCount = {
  term: string;
  /** Total occurrences across all documents. */
  count: number;
  /** How many separate documents used it. */
  documents: number;
};

/** Splits text into lowercase word tokens, dropping punctuation and numbers. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    // Sentence-ending punctuation is a boundary too, for the same reason.
    .replace(/[.!?;:|]+/g, ` ${SEGMENT_BREAK} `)
    .split(/[^a-z0-9+#]+/)
    .filter(
      (w) => w === SEGMENT_BREAK || (w.length > 1 && !/^\d+$/.test(w)),
    );
}

function isMeaningful(words: string[]): boolean {
  // Never build a phrase that spans two blocks or sentences.
  if (words.includes(SEGMENT_BREAK)) return false;
  // Drop phrases that are only filler, or that start/end on a stopword —
  // "of the best" is noise, "best coffee grinder" is not.
  if (words.some((w) => w.length < 2)) return false;
  if (STOPWORDS.has(words[0]!) || STOPWORDS.has(words[words.length - 1]!)) {
    return false;
  }
  return words.some((w) => !STOPWORDS.has(w));
}

/**
 * Counts n-word phrases across a set of documents.
 *
 * `documents` matters more than raw `count` for relevance — a term used once
 * by every competitor is a stronger signal than one repeated by a single page.
 */
export function extractTerms(
  documents: string[],
  size: 1 | 2 | 3,
  limit = 25,
): TermCount[] {
  const totals = new Map<string, number>();
  const docFreq = new Map<string, number>();

  for (const doc of documents) {
    const words = tokenize(doc);
    const seenHere = new Set<string>();

    for (let i = 0; i + size <= words.length; i++) {
      const slice = words.slice(i, i + size);
      if (!isMeaningful(slice)) continue;
      if (size === 1 && STOPWORDS.has(slice[0]!)) continue;

      const term = slice.join(" ");
      totals.set(term, (totals.get(term) ?? 0) + 1);
      seenHere.add(term);
    }

    for (const term of seenHere) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  return [...totals.entries()]
    .map(([term, count]) => ({
      term,
      count,
      documents: docFreq.get(term) ?? 0,
    }))
    .filter((t) => t.documents > 1 || documents.length === 1)
    .sort((a, b) => b.documents - a.documents || b.count - a.count)
    .slice(0, limit);
}

/**
 * Capitalised multi-word phrases — brands, products, people and places.
 *
 * A deliberately simple proper-noun heuristic rather than a model: it runs on
 * the raw text we already have and is easy to reason about when it is wrong.
 */
export function extractEntities(documents: string[], limit = 20): TermCount[] {
  const totals = new Map<string, number>();
  const docFreq = new Map<string, number>();

  for (const doc of documents) {
    const seenHere = new Set<string>();
    // Sentence-initial words are capitalised by grammar, not because they are
    // names — only take capitalised runs that don't follow a full stop.
    const matches = doc.matchAll(
      /(?<![.!?]\s)(?<![.!?]")\b([A-Z][a-zA-Z0-9'’&-]+(?:\s+[A-Z][a-zA-Z0-9'’&-]+){0,3})\b/g,
    );

    for (const m of matches) {
      const phrase = m[1]!.trim();
      const lower = phrase.toLowerCase();
      if (phrase.length < 3 || phrase.length > 48) continue;
      if (STOPWORDS.has(lower)) continue;
      // A single capitalised word is usually noise; require two, or a long one.
      if (!phrase.includes(" ") && phrase.length < 5) continue;

      totals.set(phrase, (totals.get(phrase) ?? 0) + 1);
      seenHere.add(phrase);
    }

    for (const term of seenHere) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  return [...totals.entries()]
    .map(([term, count]) => ({ term, count, documents: docFreq.get(term) ?? 0 }))
    .filter((t) => t.documents > 1)
    .sort((a, b) => b.documents - a.documents || b.count - a.count)
    .slice(0, limit);
}

const QUESTION_START =
  /^(what|how|why|when|where|who|which|can|do|does|is|are|should|will|would)\b/i;

/** Pulls question-shaped sentences and headings out of text. */
export function extractQuestions(documents: string[], limit = 15): string[] {
  const seen = new Map<string, number>();

  for (const doc of documents) {
    for (const raw of doc.split(/(?<=[.?!])\s+|\n+/)) {
      const s = raw.trim().replace(/\s+/g, " ");
      if (s.length < 12 || s.length > 120) continue;
      if (!QUESTION_START.test(s)) continue;
      if (!s.endsWith("?") && s.split(" ").length > 12) continue;

      const key = s.replace(/\?+$/, "").toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }

  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([q]) => q.charAt(0).toUpperCase() + q.slice(1) + "?");
}

/** Word count of plain text, matching how the crawler counts. */
export function wordCount(text: string): number {
  const t = text.replace(/\s+/g, " ").trim();
  return t === "" ? 0 : t.split(" ").length;
}
