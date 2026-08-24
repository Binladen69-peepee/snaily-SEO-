/**
 * Heading outline for the editor's navigator, plus the structural problems
 * that hurt both readers and search engines.
 *
 * Read straight from the draft's own HTML — the outline is whatever the
 * headings actually say, never a model's summary of the piece.
 */

import { stripHtml } from "@/lib/drafter/readability";

export type OutlineNode = {
  id: string;
  level: 2 | 3 | 4;
  text: string;
  /** Words between this heading and the next one at any level. */
  words: number;
};

export type OutlineProblem = {
  /** Index into the outline, or -1 for a document-wide problem. */
  at: number;
  severity: "error" | "warning";
  message: string;
};

export type Outline = {
  nodes: OutlineNode[];
  problems: OutlineProblem[];
};

/** Stable, readable anchor for a heading. Matches WordPress's own scheme. */
export function headingSlug(text: string, seen: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .normalize("NFKD")
      // Emoji lead most of this site's H2s and must not become the whole slug.
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "section";

  let slug = base;
  let n = 2;
  while (seen.has(slug)) {
    slug = `${base}-${String(n)}`;
    n += 1;
  }
  seen.add(slug);
  return slug;
}

const HEADING_RE = /<h([234])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

export function buildOutline(html: string): Outline {
  const nodes: OutlineNode[] = [];
  const seen = new Set<string>();

  const matches = [...html.matchAll(HEADING_RE)];

  matches.forEach((m, i) => {
    const level = Number(m[1]) as 2 | 3 | 4;
    const text = stripHtml(m[2] ?? "");
    if (text === "") return;

    // Body between this heading and the next one, so an empty section shows up.
    const from = (m.index ?? 0) + m[0].length;
    const to = matches[i + 1]?.index ?? html.length;
    const words = stripHtml(html.slice(from, to))
      .split(/\s+/)
      .filter(Boolean).length;

    nodes.push({ id: headingSlug(text, seen), level, text, words });
  });

  return { nodes, problems: findProblems(nodes, html) };
}

function findProblems(nodes: OutlineNode[], html: string): OutlineProblem[] {
  const problems: OutlineProblem[] = [];

  if (nodes.length === 0) {
    problems.push({
      at: -1,
      severity: "warning",
      message: "No headings yet. Long posts need H2s to be skimmable.",
    });
    return problems;
  }

  /*
   * An H1 in the body competes with the post title, which WordPress already
   * renders as the page's H1. Two H1s make it ambiguous which one the page is
   * actually about.
   */
  if (/<h1\b/i.test(html)) {
    problems.push({
      at: -1,
      severity: "error",
      message:
        "There is an H1 in the body. The post title is already the page's H1 — use H2 for sections.",
    });
  }

  if (nodes[0]!.level !== 2) {
    problems.push({
      at: 0,
      severity: "error",
      message: `The first heading is an H${String(nodes[0]!.level)}. Start at H2.`,
    });
  }

  const byText = new Map<string, number>();

  nodes.forEach((node, i) => {
    const prev = nodes[i - 1];

    // Jumping H2 → H4 leaves a hole in the structure that screen readers and
    // Google's outline parser both read as a missing section.
    if (prev !== undefined && node.level > prev.level + 1) {
      problems.push({
        at: i,
        severity: "error",
        message: `“${node.text}” jumps from H${String(prev.level)} to H${String(
          node.level,
        )}. Add the missing level or promote this heading.`,
      });
    }

    // An empty section is usually a heading the author never came back to.
    if (node.words === 0) {
      problems.push({
        at: i,
        severity: "warning",
        message: `“${node.text}” has no text under it.`,
      });
    }

    const key = node.text.trim().toLowerCase();
    const first = byText.get(key);
    if (first === undefined) {
      byText.set(key, i);
    } else {
      problems.push({
        at: i,
        severity: "warning",
        message: `“${node.text}” repeats a heading used earlier.`,
      });
    }
  });

  return problems;
}
