/**
 * Internal stage markers. Never legitimate prose.
 *
 * They frame model replies (`<<<SECTION:faq>>>`, `<<<END>>>`) and have shipped
 * into WordPress FAQ JSON as visible text. Stripped from markdown as it is
 * stored, and again from the assembled HTML, so a later rewrite cannot sneak
 * one back in.
 */
export const PIPELINE_MARKER_RE = /<<<[^>\n]{0,120}>>>/g;
const ENCODED_MARKER_RE = /&lt;&lt;&lt;[\s\S]{0,120}?&gt;&gt;&gt;/gi;

export function stripPipelineMarkers(html: string): string {
  return html
    .replace(PIPELINE_MARKER_RE, "")
    .replace(ENCODED_MARKER_RE, "")
    .replace(/<<<\s*(?:\/?\s*SECTION\s*:[a-z-]*|END)\s*/gi, "")
    .replace(/&lt;&lt;&lt;\s*(?:\/?\s*SECTION\s*:[a-z-]*|END)\s*(?:&gt;)*/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Strip the few things that must never round-trip into WordPress or the preview.
 * wp_kses_post is the last line on the plugin side; this keeps the editor from
 * storing event handlers or script tags in the first place.
 */
export function sanitizeEditorHtml(html: string): string {
  return stripPipelineMarkers(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(['"]?)\s*javascript:/gi, "$1=$2")
    .replace(/(href|src)\s*=\s*(['"]?)\s*data:text\/html/gi, "$1=$2");
}
