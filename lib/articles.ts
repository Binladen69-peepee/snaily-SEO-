import { prisma } from "@/lib/db";
import { buildBrief } from "@/lib/optimizer";
import { SEGMENT_BREAK } from "@/lib/text";
import type { TargetTerm } from "@/lib/content-score";

/**
 * Research attached to an article.
 *
 * Built once when the article is created and cached on the row, so opening the
 * editor never re-crawls the SERP. It is a snapshot on purpose: an article
 * should be written against the competition as it stood when work started.
 */
export type ArticleBrief = {
  difficulty: number;
  volume: number;
  cpc: number;
  /** Word count to aim for, from the median of the ranking pages. */
  targetWords: number;
  /** Internal/external links the ranking pages carry, median. */
  targetLinks: number;
  terms: TargetTerm[];
  headings: { text: string; count: number }[];
  questions: string[];
  serp: {
    position: number;
    title: string;
    url: string;
    domain: string;
    words: number;
  }[];
  /** Pages actually read when building this. */
  analysed: number;
  builtAt: string;
};

export const ARTICLE_STATUSES = [
  "preparing",
  "draft",
  "in_progress",
  "published",
] as const;

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const STATUS_LABEL: Record<ArticleStatus, string> = {
  preparing: "Preparing",
  draft: "Draft",
  in_progress: "In Progress",
  published: "Published",
};

export type ArticleRow = {
  id: string;
  title: string;
  keyword: string;
  status: ArticleStatus;
  updatedAt: string;
  words: number;
};

/**
 * Readable text from an article body.
 *
 * Bodies are HTML now that the editor is rich text, but older drafts and every
 * AI response are Markdown, so both are reduced to plain words here. Word
 * counts and keyword matching run through this, which keeps a heading worth
 * the same whether it was typed, pasted or generated.
 */
export function articleText(content: string): string {
  return content
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    // A block tag ends a phrase, so it becomes a hard boundary rather than a
    // space. Flattening to a space let n-grams stride across the join and glue
    // unrelated fragments together — "Greek yogurt</li><li>Olive oil" produced
    // the phantom phrase "greek yogurt olive". Inline tags stay a plain join,
    // or "<strong>domain</strong> name" would stop matching "domain name".
    .replace(
      /<\/?(p|div|h[1-6]|li|ul|ol|br|blockquote|pre|tr|td|th|table|figure|figcaption|hr)\b[^>]*>/gi,
      ` ${SEGMENT_BREAK} `,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words in an article body. */
export function markdownWords(content: string): number {
  const text = articleText(content);
  return text === "" ? 0 : text.split(" ").length;
}

/** Links in a body, whether written as HTML or Markdown. */
export function markdownLinks(content: string): number {
  return (
    (content.match(/<a\s[^>]*href=/gi) ?? []).length +
    (content.match(/(?<!!)\[[^\]]+\]\([^)]+\)/g) ?? []).length
  );
}

/** Images in a body — surfaced alongside words and links in the editor. */
export function articleImages(content: string): number {
  return (
    (content.match(/<img\s/gi) ?? []).length +
    (content.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length
  );
}

export function parseBrief(value: unknown): ArticleBrief | null {
  if (value === null || typeof value !== "object") return null;
  const b = value as Partial<ArticleBrief>;
  return Array.isArray(b.terms) && typeof b.targetWords === "number"
    ? (value as ArticleBrief)
    : null;
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
 * Researches an article's keyword and stores the result on the row.
 *
 * Runs detached from the request that created the article — the list shows
 * "Preparing" until this lands, exactly like KeySearch. Failures are recorded
 * on the row rather than thrown, so a blocked crawl leaves an explanation
 * instead of an article stuck forever in "Preparing".
 */
export async function prepareArticle(
  articleId: string,
  keyword: string,
  country: string,
): Promise<void> {
  try {
    const brief = await buildBrief(keyword, country);
    const detail = brief.analysed;

    // Sensible floors when SERP pages were blocked — the editor still needs
    // targets to work against rather than sitting on zeros forever.
    const targetWords =
      brief.targetWords.median > 0 ? brief.targetWords.median : 1_200;
    const targetLinks =
      median(detail.map((p) => p.links).filter((n) => n > 0)) || 5;

    const payload: ArticleBrief = {
      difficulty: brief.keywordMetrics.difficulty,
      volume: brief.keywordMetrics.volume,
      cpc: brief.keywordMetrics.cpc,
      targetWords,
      targetLinks,
      terms: brief.targets,
      headings: brief.headings,
      questions: brief.questions,
      serp: detail.map((p, i) => ({
        position: i + 1,
        title: p.title,
        url: p.url,
        domain: p.domain,
        words: p.words,
      })),
      analysed: detail.length,
      builtAt: new Date().toISOString(),
    };

    await prisma.article.update({
      where: { id: articleId },
      data: { brief: payload, status: "draft", briefError: null },
    });
  } catch (err) {
    await prisma.article
      .update({
        where: { id: articleId },
        data: {
          status: "draft",
          briefError:
            err instanceof Error
              ? err.message
              : "Could not research this keyword.",
        },
      })
      // The article itself is fine without research; never let bookkeeping
      // failures surface as an unhandled rejection.
      .catch(() => undefined);
  }
}
