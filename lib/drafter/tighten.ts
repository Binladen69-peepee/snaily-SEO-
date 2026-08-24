/**
 * Splits over-long paragraphs after generation.
 *
 * Measured across the six most recent published posts, 30% of paragraphs are
 * one sentence, 39% two and 19% three — an average of 2.2. Drafts were coming
 * back at 3.6–4.1 even after the prompt was told twice, in two places, to keep
 * them short. Language models are unreliable at obeying length constraints, so
 * this stops asking and just does it.
 *
 * Formatting only: no word is added, removed or reordered. It inserts a
 * paragraph break, which is exactly the edit the author would make by hand.
 */

/** Beyond this, a block of prose reads as a wall on a phone. */
const MAX_SENTENCES = 3;

/** Where to break a long paragraph so the halves stay balanced. */
const TARGET = 2;

/**
 * Lines that must never be touched.
 *
 * Headings, list items, tables, quotes and the recipe-card metadata are
 * structural — splitting them would corrupt the document rather than tidy it.
 */
function isStructural(line: string): boolean {
  const t = line.trimStart();
  return (
    t === "" ||
    t.startsWith("#") ||
    t.startsWith("-") ||
    t.startsWith("*") ||
    t.startsWith(">") ||
    t.startsWith("|") ||
    t.startsWith("```") ||
    /^\d+[.)]\s/.test(t) ||
    // "Yield: 9 cups", "Prep Time: 12 minutes" — one metadata pair per line.
    /^[A-Z][A-Za-z ]{2,24}:\s/.test(t)
  );
}

/**
 * Sentence boundaries that survive real recipe prose.
 *
 * Splitting naively on ". " mangles "350°F (175°C). Cook" far less than it
 * mangles abbreviations and decimals, so the lookahead requires a capital or a
 * quote to start the next sentence.
 */
function toSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=["“'(]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Joins a paragraph that the model wrapped across several lines.
 *
 * Sentence counting below is per line, so a wrapped paragraph would read as
 * four one-sentence paragraphs and never be split even when it needs it. In
 * Markdown those lines are one paragraph anyway, so joining them is what the
 * document already means.
 */
function unwrap(markdown: string): string {
  const lines = markdown.split(/\n/);
  const out: string[] = [];

  for (const line of lines) {
    const previous = out[out.length - 1];
    const joinable =
      previous !== undefined &&
      !isStructural(previous) &&
      !isStructural(line) &&
      previous.trim() !== "";

    if (joinable) out[out.length - 1] = `${previous.trimEnd()} ${line.trim()}`;
    else out.push(line);
  }

  return out.join("\n");
}

export function tightenParagraphs(markdown: string): string {
  return unwrap(markdown)
    .split(/\n/)
    .map((line) => {
      if (isStructural(line)) return line;

      const sentences = toSentences(line.trim());
      if (sentences.length <= MAX_SENTENCES) return line;

      const chunks: string[] = [];
      for (let i = 0; i < sentences.length; i += TARGET) {
        chunks.push(sentences.slice(i, i + TARGET).join(" "));
      }

      // A trailing single sentence is fine — 30% of real paragraphs are one.
      return chunks.join("\n\n");
    })
    .join("\n");
}
