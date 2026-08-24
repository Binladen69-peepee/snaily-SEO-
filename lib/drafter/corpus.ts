import { prisma } from "@/lib/db";

/** How many recently published posts ground the voice. */
export const STYLE_SAMPLE_COUNT = 6;

/** Per-post cap so six samples still fit a prompt. */
/*
 * Trimmed from 2,400. Six samples is the requirement — they are the strongest
 * available signal for the house voice — but six times 2,400 characters is
 * about 3,600 tokens of context before the style guide, the recipe or the task
 * are added, and the model this account can reach allows 8,000 tokens for the
 * whole request. 1,400 characters still shows rhythm, joke density and
 * paragraph length, which is what the samples are read for.
 */
const SAMPLE_CHARS = 1_400;

function toPlain(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type StyleSample = {
  title: string;
  publishedAt: string | null;
  excerpt: string;
};

/**
 * The six most recently published WordPress posts for this project.
 *
 * Drafter does not fine-tune a model. Each generation is few-shot against
 * whatever is live on the site right now, so the voice tracks the latest
 * posts instead of freezing on the training PDFs.
 */
export async function recentStyleSamples(
  projectId: string,
): Promise<StyleSample[]> {
  const rows = await prisma.wpPost.findMany({
    where: { projectId, status: "publish", type: "post" },
    orderBy: { publishedAt: "desc" },
    take: STYLE_SAMPLE_COUNT,
    select: {
      title: true,
      content: true,
      publishedAt: true,
    },
  });

  return rows.map((row) => {
    const text = toPlain(row.content);
    const excerpt =
      text.length <= SAMPLE_CHARS
        ? text
        : `${text.slice(0, SAMPLE_CHARS).replace(/\s+\S*$/, "")}…`;
    return {
      title: row.title,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      excerpt,
    };
  });
}

/**
 * Median word count of the client's recent published posts.
 *
 * The depth target used to come from the SERP alone, which measures what other
 * people write about the keyword. That is worth knowing, but it is not the
 * question: a Cinnamon Snail post has a fixed set of sections and a house
 * length, and a draft that comes in at half of it reads as unfinished no matter
 * what page one is doing. Zero when nothing is synced, and the caller falls
 * back to the SERP.
 */
export async function recentPostLength(projectId: string): Promise<number> {
  const rows = await prisma.wpPost.findMany({
    where: { projectId, status: "publish", type: "post" },
    orderBy: { publishedAt: "desc" },
    take: STYLE_SAMPLE_COUNT,
    select: { content: true },
  });

  const lengths = rows
    .map((r) => toPlain(r.content).split(/\s+/).filter(Boolean).length)
    .filter((n) => n > 200)
    .sort((a, b) => a - b);

  if (lengths.length === 0) return 0;
  const mid = Math.floor(lengths.length / 2);
  return lengths.length % 2 === 0
    ? Math.round((lengths[mid - 1]! + lengths[mid]!) / 2)
    : lengths[mid]!;
}

/** Prompt block. Empty string when WordPress has not been synced yet. */
export function formatSamples(samples: StyleSample[]): string {
  if (samples.length === 0) {
    return [
      "No recent published posts are available yet (WordPress is not synced).",
      "Match the style guide and playbook exactly.",
    ].join("\n");
  }

  const blocks = samples.map((s, i) => {
    const when = s.publishedAt
      ? new Date(s.publishedAt).toISOString().slice(0, 10)
      : "unknown date";
    return `### Sample ${String(i + 1)} — ${s.title} (${when})\n${s.excerpt}`;
  });

  return [
    `These are the ${String(samples.length)} most recently published posts.`,
    "Match their rhythm, joke density, paragraph length, and how they handle",
    "foreign dish names. Do not copy sentences.",
    "",
    ...blocks,
  ].join("\n");
}
