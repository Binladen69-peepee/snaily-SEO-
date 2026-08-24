/**
 * Finding plain text inside HTML, safely.
 *
 * Both link passes — the author's ingredient affiliates and the site's own
 * internal recipes — need the same thing: the stretches of a document that are
 * real prose, never a tag, never inside an existing anchor or heading. The
 * logic was written once for affiliates and the internal pass needed it too;
 * having two copies of "which characters am I allowed to rewrite" is how one
 * of them eventually nests an anchor inside another.
 */

export type Region = { from: number; to: number };

export function escapeRe(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Spans that must never be rewritten: existing links, headings, code, and any
 * tag's own attributes. Rewriting inside one either nests an anchor (invalid
 * HTML) or corrupts the markup.
 */
function protectedSpans(): RegExp {
  // Built per call: a shared /g regex carries `lastIndex` between callers and
  // silently skips matches when two scans interleave.
  return /<a\b[^>]*>[\s\S]*?<\/a>|<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>|<(?:script|style|code|pre)\b[^>]*>[\s\S]*?<\/(?:script|style|code|pre)>|<[^>]+>/gi;
}

/** Character ranges that are plain text, outside every protected span. */
export function editableRuns(html: string): Region[] {
  const runs: Region[] = [];
  const re = protectedSpans();
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) runs.push({ from: last, to: m.index });
    last = m.index + m[0].length;
  }
  if (last < html.length) runs.push({ from: last, to: html.length });
  return runs;
}

export type TermMatch = { start: number; end: number; text: string };

/**
 * First occurrence of `term` in editable text, as absolute offsets.
 *
 * `\b` is not used: it treats a trailing hyphen or apostrophe as a boundary in
 * ways that misfire on ingredient and recipe names, so the boundaries are
 * written out as "not a word character or hyphen" on each side. That is what
 * stops "tamari" matching inside "tamarind".
 */
export function findTermMatch(html: string, term: string): TermMatch | null {
  const re = new RegExp(`(^|[^\\w-])(${escapeRe(term)})(?![\\w-])`, "i");

  for (const run of editableRuns(html)) {
    const hit = re.exec(html.slice(run.from, run.to));
    if (hit === null) continue;
    const start = run.from + hit.index + (hit[1] ?? "").length;
    const matched = hit[2] ?? term;
    return { start, end: start + matched.length, text: matched };
  }
  return null;
}
