/**
 * A compact voice brief, measured from the six most recent published posts.
 *
 * The old approach sent all six posts into every call. Six posts is the right
 * evidence, but as raw text it costs roughly 3,600 tokens per request against
 * an 8,000-token ceiling, which is most of the budget spent re-teaching the
 * model something it was told a minute ago. So the posts are measured once per
 * job and what travels is the measurement plus two short excerpts: about 700
 * characters that say what the numbers are, instead of 8,000 that imply them.
 *
 * The numbers are observations of the client's real posts, never targets
 * invented here. When WordPress has not been synced there is nothing to
 * measure and the brief says so rather than inventing a house style.
 */

import { recentStyleSamples, type StyleSample } from "@/lib/drafter/corpus";
import { prisma } from "@/lib/db";

/**
 * A pictographic character opening a heading.
 *
 * `\p{Extended_Pictographic}` rather than a hand-written codepoint range: the
 * site's headings use 🤷‍♀️ and ✌️, which are sequences with joiners and
 * variation selectors, and every range-based version of this check silently
 * missed them.
 */
const LEADING_EMOJI = /^\s*\p{Extended_Pictographic}/u;

export type StyleMeasurements = {
  posts: number;
  /** Share of H2s that open with an emoji, 0–1. */
  emojiHeadingShare: number;
  /** Median sentences per paragraph. */
  medianParagraphSentences: number;
  /** Mean words per sentence. */
  meanSentenceWords: number;
  /** H2s actually used recently, deduped, for the model to echo the format. */
  headings: string[];
  /** Two short paragraphs that show the rhythm. */
  excerpts: string[];
};

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= 2);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Measures the corpus.
 *
 * Works on the plain-text excerpts the corpus already produces, so the
 * paragraph counts are of real published paragraphs, not of anything this
 * pipeline wrote.
 */
export function measureStyle(
  samples: StyleSample[],
  headings: string[],
): StyleMeasurements {
  const paragraphSentences: number[] = [];
  const sentenceWords: number[] = [];
  const excerpts: string[] = [];

  for (const sample of samples) {
    const paras = sample.excerpt
      .split(/\n{2,}|(?<=[.!?])\s{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40);

    for (const para of paras) {
      const sents = sentences(para);
      if (sents.length === 0) continue;
      paragraphSentences.push(sents.length);
      for (const s of sents) {
        sentenceWords.push(s.split(/\s+/).filter(Boolean).length);
      }
    }

    const candidate = paras.find((p) => p.length > 120 && p.length < 320);
    if (candidate !== undefined && excerpts.length < 2) excerpts.push(candidate);
  }

  const withEmoji = headings.filter((h) => LEADING_EMOJI.test(h)).length;

  return {
    posts: samples.length,
    emojiHeadingShare: headings.length === 0 ? 0 : withEmoji / headings.length,
    medianParagraphSentences: median(paragraphSentences),
    meanSentenceWords:
      sentenceWords.length === 0
        ? 0
        : Math.round(
            sentenceWords.reduce((a, b) => a + b, 0) / sentenceWords.length,
          ),
    headings: [...new Set(headings)].slice(0, 12),
    excerpts,
  };
}

/** The brief as it goes into a prompt. Kept under ~900 characters on purpose. */
export function formatStyleBrief(m: StyleMeasurements): string {
  if (m.posts === 0) {
    return [
      "VOICE REFERENCE: unavailable.",
      "WordPress is not synced, so there are no recent posts to measure.",
      "Follow the written style guide exactly and do not guess at house habits.",
    ].join("\n");
  }

  const lines = [
    `VOICE REFERENCE, measured from the ${String(m.posts)} most recent published posts:`,
    `- ${String(Math.round(m.emojiHeadingShare * 100))}% of H2s open with an emoji.`,
    `- Paragraphs run ${String(m.medianParagraphSentences)} sentence(s); sentences average ${String(m.meanSentenceWords)} words.`,
  ];

  if (m.headings.length > 0) {
    lines.push(`- H2s used recently: ${m.headings.slice(0, 8).join(" / ")}`);
  }

  if (m.excerpts.length > 0) {
    lines.push("- Rhythm to match (do not copy these sentences):");
    for (const e of m.excerpts) {
      lines.push(`  "${e.slice(0, 220)}"`);
    }
  }

  return lines.join("\n");
}

/** Headings the site actually publishes, read from synced WordPress content. */
export async function recentHeadings(projectId: string): Promise<string[]> {
  const rows = await prisma.wpPost.findMany({
    where: { projectId, status: "publish", type: "post" },
    orderBy: { publishedAt: "desc" },
    take: 6,
    select: { content: true },
  });

  const headings: string[] = [];
  for (const row of rows) {
    for (const m of row.content.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
      const text = (m[1] ?? "").replace(/<[^>]+>/g, "").trim();
      if (text !== "") headings.push(text);
    }
  }
  return headings;
}

/** Builds the brief for a project. Called once per job, then cached in state. */
export async function buildStyleBrief(projectId: string): Promise<string> {
  const [samples, headings] = await Promise.all([
    recentStyleSamples(projectId),
    recentHeadings(projectId),
  ]);
  return formatStyleBrief(measureStyle(samples, headings));
}
