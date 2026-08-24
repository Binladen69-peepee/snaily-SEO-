/**
 * Turning the stage outputs into one document, and back again.
 *
 * Sections are written and stored as Markdown because that is what survives a
 * partial job: a section is either there or it is not, and nothing depends on
 * a half-written tag. HTML is produced once, at the point the first stage
 * actually needs a document — after which every later stage edits that HTML in
 * place, so the links inserted at step 8 are still there at step 12.
 */

import { toEditorHtml } from "@/lib/markdown";
import { normaliseStepHeadings } from "@/lib/drafter/steps";
import { bulletsToParagraphs } from "@/lib/drafter/section-shape";
import { tightenParagraphs } from "@/lib/drafter/tighten";
import { stripHtml } from "@/lib/drafter/readability";
import { stripPipelineMarkers } from "@/lib/drafter/sanitize";
import { SECTION_KEYS, type JobState, type SectionKey } from "@/lib/jobs/types";

/** Sections in publication order, skipping the ones this post does not use. */
export function orderedSections(state: JobState): SectionKey[] {
  const planned = state.outline?.sections.map((s) => s.key) ?? [...SECTION_KEYS];
  const written = state.sections ?? {};
  return planned.filter((key) => (written[key] ?? "").trim() !== "");
}

/** The FAQ as Markdown, from the structured questions the FAQ stage stored. */
export function faqMarkdown(state: JobState): string {
  const faq = state.faq ?? [];
  if (faq.length === 0) return "";

  const heading =
    state.outline?.sections.find((s) => s.key === "faq")?.heading ??
    "🤷‍♀️ Recipe FAQs";

  /*
   * Questions are H3s, not bold paragraphs.
   *
   * That is what the export's section mapper reads them as when it builds the
   * Yoast FAQ block, and bold text meant it found none: the questions rendered
   * fine in the editor and arrived in WordPress as plain prose with no FAQ
   * schema behind them. Nothing warned, because there was nothing wrong with
   * the words.
   */
  return [
    `## ${heading}`,
    ...faq.map((entry) => `### ${entry.question}\n\n${entry.answer}`),
  ].join("\n\n");
}

/**
 * Composes the article body.
 *
 * The intro carries no heading — that is the house format, and the WordPress
 * template expects the opening paragraphs to sit above the first H2.
 */
export function composeMarkdown(state: JobState): string {
  const written = state.sections ?? {};
  const parts: string[] = [];

  for (const key of orderedSections(state)) {
    const body = (written[key] ?? "").trim();
    if (body === "") continue;

    if (key === "faq") {
      // Held structured so the export can build a real Yoast FAQ block.
      continue;
    }

    /*
     * The method is renumbered here rather than at any one writing stage,
     * because three of them can produce it: the section group, a split second
     * half, and the expand pass. Composing is the single funnel they all go
     * through.
     */
    const shaped =
      key === "steps"
        ? normaliseStepHeadings(body)
        : key === "why"
          ? bulletsToParagraphs(body)
          : body;

    const heading = state.outline?.sections.find((s) => s.key === key)?.heading ?? "";
    const hasHeading = /^\s*##\s/m.test(shaped);

    if (key === "intro" || heading === "" || hasHeading) {
      parts.push(shaped);
    } else {
      parts.push(`## ${heading}\n\n${shaped}`);
    }
  }

  const faq = faqMarkdown(state);
  if (faq !== "") {
    // The FAQ sits between Top tips and the closing list, as the site does it.
    const relatedAt = parts.findIndex((p) => /^##\s*\S*\s*You'?ll/im.test(p));
    if (relatedAt === -1) parts.push(faq);
    else parts.splice(relatedAt, 0, faq);
  }

  return parts.join("\n\n");
}

export function composeHtml(state: JobState): string {
  return stripPipelineMarkers(toEditorHtml(tightenParagraphs(composeMarkdown(state))));
}

export function proseWords(html: string): number {
  const withoutHeadings = html.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, " ");
  return stripHtml(withoutHeadings).split(/\s+/).filter(Boolean).length;
}

export function totalWords(html: string): number {
  return stripHtml(html).split(/\s+/).filter(Boolean).length;
}

/**
 * Compact plain text for a prompt, from HTML.
 *
 * Sending tags to a model is paying for angle brackets. Headings survive as
 * Markdown so the structure is still legible to it.
 */
export function htmlToCompact(html: string): string {
  return html
    .replace(/<img\b[^>]*>/gi, "\n[image]\n")
    .replace(/<h2\b[^>]*>/gi, "\n## ")
    .replace(/<h3\b[^>]*>/gi, "\n### ")
    .replace(/<h4\b[^>]*>/gi, "\n#### ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[2-4]|li|blockquote|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type MaskedLinks = { text: string; hrefs: string[] };

/**
 * Hides anchors behind markers so a text-editing model cannot lose them.
 *
 * The proofreading stage runs after the link stages, which is the right order
 * for the author — but it means a model is being handed a document whose URLs
 * are the most valuable and most fragile thing in it. Rather than trusting it
 * to copy hrefs verbatim, the URLs never reach it: it sees `⟦1⟧sriracha⟦/1⟧`
 * and edits the words. If a marker comes back missing, the chunk is rejected
 * whole and the original kept, so a proofread can cost a correction but never
 * a link.
 */
export function maskAnchors(html: string): MaskedLinks {
  const hrefs: string[] = [];
  const text = html.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (_whole, attrs: string, inner: string) => {
      const i = hrefs.length;
      hrefs.push(attrs);
      return `⟦${String(i)}⟧${inner}⟦/${String(i)}⟧`;
    },
  );
  return { text, hrefs };
}

/** Restores masked anchors. Returns null when any marker went missing. */
export function unmaskAnchors(text: string, hrefs: string[]): string | null {
  let out = text;

  for (let i = 0; i < hrefs.length; i += 1) {
    const open = `⟦${String(i)}⟧`;
    const close = `⟦/${String(i)}⟧`;
    const from = out.indexOf(open);
    const to = out.indexOf(close);
    if (from === -1 || to === -1 || to < from) return null;

    const inner = out.slice(from + open.length, to);
    out =
      out.slice(0, from) +
      `<a${hrefs[i]!}>${inner}</a>` +
      out.slice(to + close.length);
  }

  // A stray marker means the model invented one; the chunk is not trustworthy.
  return /⟦\/?\d+⟧/.test(out) ? null : out;
}

/**
 * Splits a document at H2 boundaries into chunks under a character budget.
 *
 * Whole sections stay together wherever they fit, because a proofreader handed
 * half a paragraph writes a different sentence than one that can see the end of
 * it.
 */
export function chunkByHeading(html: string, maxChars: number): string[] {
  const parts = html.split(/(?=<h2\b)/i).filter((p) => p.trim() !== "");
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    if (current !== "" && current.length + part.length > maxChars) {
      chunks.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current.trim() !== "") chunks.push(current);

  return chunks;
}

/**
 * Replaces the dashes the house style does not use.
 *
 * Em dashes read as AI-written and the style guide bans them outright. The
 * substitution is lossless, so it is applied rather than reported — and applied
 * twice, because the proofreading stage runs after the style check and models
 * reliably "correct" a plain hyphen into an em dash on the way past.
 *
 * A spaced en dash is the same clause-connector tic wearing a different hat.
 * An unspaced one is a numeric range (350-375°F) and is left alone.
 */
export function normaliseDashes(html: string): { html: string; changed: number } {
  let changed = 0;
  const out = html
    .replace(/\s+—\s+/g, () => {
      changed += 1;
      return " - ";
    })
    .replace(/—/g, () => {
      changed += 1;
      return "-";
    })
    .replace(/\s+–\s+/g, () => {
      changed += 1;
      return " - ";
    })
    .replace(/(?<=[A-Za-z])\s*–\s*(?=[A-Za-z])/g, () => {
      changed += 1;
      return " - ";
    });
  return { html: out, changed };
}

/**
 * Removes a block whose entire content is a placeholder.
 *
 * Only whole blocks, and only ones that are nothing but the placeholder. A
 * paragraph that happens to contain the word TODO in a sentence is prose, and
 * deleting it because a pattern matched would lose the author real writing to
 * protect them from a marker that was never there.
 */
export function stripPlaceholderBlocks(html: string): {
  html: string;
  removed: number;
} {
  let removed = 0;
  const out = html.replace(
    /<(p|li|h[23])\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (whole, _tag: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const isPlaceholder =
        /^!\[[^\]]*\]/.test(text) ||
        /^\[(?:insert|write|add|your|todo|tbd)[^\]]*\]$/i.test(text) ||
        /^\{\{[^}]*\}\}$/.test(text) ||
        /^(?:TODO|TBD)\b/.test(text);
      if (!isPlaceholder) return whole;
      removed += 1;
      return "";
    },
  );
  return { html: out, removed };
}
