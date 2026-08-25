/**
 * The Recipe Card and SEO sections, written into the document body.
 *
 * The client asked for this directly: "the document should have the info for
 * the recipe card in it itself". Until now the card and the Yoast fields were
 * metadata hanging off the article — real, exported correctly, but invisible
 * in the document the author reads and hands around. A writer checking their
 * work in Google Docs could not see the yield, the times, or the meta
 * description that was about to ship.
 *
 * These sections render the same canonical `ArticleDocument` the exporter
 * consumes, so what the author reads is what WordPress receives. They are the
 * document's last two sections, matching the Vegan Tamale Pie reference.
 *
 * Fields the author has not filled in are omitted rather than shown blank or
 * filled with a guess.
 */

import {
  formatMinutes,
  hasRecipe,
  type ArticleDocument,
  type DocumentRecipeCard,
  type DocumentSeo,
} from "@/lib/drafter/document";

/** Heading text used to find these sections again after a round trip. */
export const RECIPE_CARD_HEADING = "📋 Recipe Card";
export const SEO_HEADING = "🔍 SEO";

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
    card.openingSentence.trim() === ""
      ? ""
      : `<p>${escapeHtml(card.openingSentence.trim())}</p>`,
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
    row("Focus keyword", seo.focusKeyword),
    row("SEO title", seo.seoTitle),
    row("SEO Meta description", seo.metaDescription),
    row("URL slug", seo.slug),
    row("Primary Category", seo.primaryCategory),
    row("Other Categories", seo.otherCategories.join(", ")),
  ];

  return blocks.filter((b) => b !== "").join("\n");
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
 * Append the Recipe Card and SEO sections to a document body.
 *
 * Idempotent: running it on a body that already carries a section leaves that
 * section alone, so a redraft cannot stack duplicates.
 */
export function withDocumentSections(
  content: string,
  doc: ArticleDocument,
): string {
  const parts = [content.trimEnd()];

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
