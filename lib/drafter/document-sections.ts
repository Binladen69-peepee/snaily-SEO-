/**
 * Everything the document carries after the prose.
 *
 * The client's own drafts — the vegan lasagna, the jackfruit enchiladas, the
 * torta de milanesa — all end the same way, and this renders that ending:
 *
 *   1. the four verified post IDs behind "you'll also love these"
 *   2. the recipe card
 *   3. the Yoast block
 *
 * He asked for it directly: "the document should have the info for the recipe
 * card in it itself". The card and the Yoast fields were real and exported
 * correctly and were nowhere the author could see them, so a writer checking
 * their work in Google Docs could not read the yield, the times, or the meta
 * description about to ship under their name. This module existed and rendered
 * two of the three; nothing in the pipeline called it.
 *
 * These sections render the same canonical `ArticleDocument` the exporter
 * consumes, so what the author reads is what WordPress receives.
 *
 * Fields the author has not filled in are omitted rather than shown blank or
 * filled with a guess.
 */

import { classifyHeading } from "@/lib/wordpress/sections";
import { FSRI_CARDS, type RelatedPost } from "@/lib/drafter/related-posts";
import {
  formatMinutes,
  hasRecipe,
  type ArticleDocument,
  type DocumentRecipeCard,
  type DocumentSeo,
} from "@/lib/drafter/document";

/** Heading text used to find these sections again after a round trip. */
export const RECIPE_CARD_HEADING = "📋 Recipe Card";
export const SEO_HEADING = "🔍 Yoast SEO";
export const RELATED_HEADING = "✌️ You'll also love these:";

/** The line that names the posts the Feast grid will render. */
const FSRI_LABEL = "FSRI post IDs";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** One "Label: value" row, or nothing when the value is empty. */
function row(label: string, value: string): string {
  const clean = value.trim();
  if (clean === "") return "";
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(clean)}</p>`;
}

function list(label: string, items: string[]): string {
  if (items.length === 0) return "";
  const rows = items
    .map((i) => `<li>${escapeHtml(i)}</li>`)
    .join("\n");
  return `<p><strong>${escapeHtml(label)}:</strong></p>\n<ul>\n${rows}\n</ul>`;
}

/**
 * The recipe card as document prose.
 *
 * Ingredients and instructions are printed exactly as stored — this function
 * does no parsing, splitting, renumbering or correcting of either.
 */
export function renderRecipeCardSection(card: DocumentRecipeCard): string {
  if (!hasRecipe(card)) return "";

  const blocks = [
    `<h2>${RECIPE_CARD_HEADING}</h2>`,
    row("Recipe title", card.title),
    row("Summary", card.openingSentence),
    row("Yield", card.recipeYield),
    row("Estimated Cost", card.estimatedCost),
    row("Prep Time", formatMinutes(card.prepMinutes)),
    row(
      card.customTimeLabel.trim() === "" ? "Custom Time" : card.customTimeLabel,
      formatMinutes(card.customMinutes),
    ),
    row("Cook Time", formatMinutes(card.cookMinutes)),
    row("Total Time", formatMinutes(card.totalMinutes)),
    row("Courses", card.course.join(", ")),
    row("Cuisine", card.cuisine.join(", ")),
    row("Diet", card.diet.join(", ")),
    list("Equipment", card.equipment),
    list("Ingredients", card.ingredients),
  ];

  if (card.instructions.length > 0) {
    const steps = card.instructions
      .map((s) => {
        const name = s.name.trim();
        const text = escapeHtml(s.text);
        return name === ""
          ? `<li>${text}</li>`
          : `<li><strong>${escapeHtml(name)}:</strong> ${text}</li>`;
      })
      .join("\n");
    blocks.push(`<p><strong>Instructions:</strong></p>\n<ol>\n${steps}\n</ol>`);
  }

  blocks.push(list("Tips", card.tips));

  return blocks.filter((b) => b !== "").join("\n");
}

/**
 * The Yoast/SEO block as document prose.
 *
 * These are the exact values the export sends, printed so the author can read
 * them before anything reaches WordPress.
 */
export function renderSeoSection(seo: DocumentSeo): string {
  const anything =
    seo.focusKeyword !== "" ||
    seo.metaDescription !== "" ||
    seo.slug !== "" ||
    seo.primaryCategory !== "" ||
    seo.otherCategories.length > 0;
  if (!anything) return "";

  const blocks = [
    `<h2>${SEO_HEADING}</h2>`,
    row("Focus keyphrase", seo.focusKeyword),
    row("SEO title", seo.seoTitle),
    row("Meta description", seo.metaDescription),
    row("URL slug", seo.slug),
    row("Primary Category", seo.primaryCategory),
    row("Other Categories", seo.otherCategories.join(", ")),
  ];

  return blocks.filter((b) => b !== "").join("\n");
}

/**
 * The four posts the Feast grid will render, written into the document.
 *
 * On the client's template this section is not prose — it is an FSRI block
 * that takes post IDs. The author was writing recipe names and the exporter
 * was quietly turning them into a grid, so the document said one thing and the
 * published page showed another, and a name that resolved to nothing simply
 * vanished with no note anywhere.
 *
 * Printing the IDs makes the section auditable before it ships: four names,
 * four numbers, and a visible shortfall when fewer than four resolved.
 */
export function renderFsriLine(related: RelatedPost[]): string {
  if (related.length === 0) return "";
  const ids = related.map((r) => String(r.wpId)).join(", ");

  /*
   * The grid has four slots. The writer is asked for three to six names so
   * there are spares when one does not match a published post, and when fewer
   * than four survive that has to be visible: a short grid on a live page is
   * the kind of thing nobody notices until a reader does.
   */
  const short =
    related.length < FSRI_CARDS
      ? ` <em>(${String(related.length)} of ${String(FSRI_CARDS)} — the rest did not match a published post)</em>`
      : "";

  return `<p><strong>${FSRI_LABEL}:</strong> ${escapeHtml(ids)}${short}</p>`;
}

/** A whole related section, for an article that came back without one. */
export function renderRelatedSection(related: RelatedPost[]): string {
  if (related.length === 0) return "";
  const items = related
    .map((r) => `<li>${escapeHtml(r.title)}</li>`)
    .join("\n");
  return [
    `<h2>${RELATED_HEADING}</h2>`,
    `<ul>\n${items}\n</ul>`,
    renderFsriLine(related),
  ].join("\n");
}

/**
 * Put the verified IDs into the article's own related section.
 *
 * The author's wording is left exactly as written; only the ID line is added,
 * and only once, so a redraft cannot stack copies of it.
 */
export function withFsriIds(content: string, related: RelatedPost[]): string {
  if (related.length === 0) return content;
  const line = renderFsriLine(related);
  if (content.includes(`<strong>${FSRI_LABEL}:</strong>`)) return content;

  const parts = content.split(/(?=<h2\b)/i);
  let found = false;
  const out = parts.map((part) => {
    if (found) return part;
    const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(part);
    if (heading === null) return part;
    const text = (heading[1] ?? "").replace(/<[^>]+>/g, " ");
    if (classifyHeading(text) !== "related") return part;
    found = true;
    return `${part.trimEnd()}\n${line}`;
  });

  // No related section at all: add one, so the grid is never a silent surprise.
  return found ? out.join("") : `${content.trimEnd()}\n\n${renderRelatedSection(related)}`;
}

/** True when the body already carries the section, so it is not added twice. */
export function hasSection(content: string, heading: string): boolean {
  const bare = heading.replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const pattern = new RegExp(
    `<h2\\b[^>]*>[\\s\\S]*?${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?</h2>`,
    "i",
  );
  return pattern.test(content);
}

/**
 * The document, in the order the client's format puts it.
 *
 *   1. the article, ending on "you'll also love these"
 *   2. the four verified FSRI post IDs that section resolves to
 *   3. the recipe card
 *   4. the Yoast block
 *
 * Idempotent: a section already present is left alone, so a redraft or a
 * second export cannot stack duplicates.
 */
export function withDocumentSections(
  content: string,
  doc: ArticleDocument,
  related: RelatedPost[] = [],
): string {
  const parts = [withFsriIds(content.trimEnd(), related)];

  const card = renderRecipeCardSection(doc.recipeCard);
  if (card !== "" && !hasSection(content, RECIPE_CARD_HEADING)) {
    parts.push(card);
  }

  const seo = renderSeoSection(doc.seo);
  if (seo !== "" && !hasSection(content, SEO_HEADING)) {
    parts.push(seo);
  }

  return parts.filter((p) => p !== "").join("\n\n");
}
