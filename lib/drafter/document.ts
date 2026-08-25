/**
 * The one structured object an article is.
 *
 * Before this, the same fact lived in several places and each consumer went
 * and got its own copy: the meta description sat in `editorial.seoDescription`
 * while the excerpt sat in `editorial.excerpt`, and the exporter sent them as
 * two independent fields — so a post could ship a meta description that said
 * one thing and an excerpt that said another. The primary category was
 * whichever name happened to be first in a flat array, with nothing naming it
 * as primary. Recipe-card fields the client's template asks for had nowhere to
 * live at all.
 *
 * `ArticleDocument` is that single structure. It is derived once from what the
 * author stored, and the editor, proofreader, exporter and WordPress connector
 * all read the same instance. Nothing downstream re-derives an SEO value.
 *
 * Two rules hold throughout:
 *   - The recipe is immutable. Ingredients and instructions are copied across
 *     exactly as the author entered them, never reordered, corrected, parsed
 *     into parts or inferred from the prose.
 *   - Nothing here invents a value. A field the author did not supply stays
 *     empty, and the export omits it, rather than a plausible guess reaching
 *     a published page.
 */

import { parseEditorial, type EditorialMeta } from "@/lib/drafter/editorial";
import { parseRecipe, type RecipeCard } from "@/lib/drafter/recipe";

/** The SEO block the client's template carries, and Yoast consumes. */
export type DocumentSeo = {
  focusKeyword: string;
  /** Also becomes the WordPress excerpt. One value, two destinations. */
  metaDescription: string;
  seoTitle: string;
  slug: string;
  /** Exactly one, or empty. Yoast stores one primary category. */
  primaryCategory: string;
  /** Every other category, primary excluded. */
  otherCategories: string[];
};

/** The recipe-card fields the client's template asks for. */
export type DocumentRecipeCard = {
  title: string;
  openingSentence: string;
  recipeYield: string;
  estimatedCost: string;
  prepMinutes: number;
  cookMinutes: number;
  customTimeLabel: string;
  customMinutes: number;
  /** prep + cook + custom. Derived, never stored, so it cannot drift. */
  totalMinutes: number;
  course: string[];
  cuisine: string[];
  diet: string[];
  equipment: string[];
  /** Verbatim. Never rewritten. */
  ingredients: string[];
  /** Verbatim. Never rewritten or reordered. */
  instructions: { text: string; name: string }[];
  tips: string[];
};

export type DocumentSection = {
  /** The H2 as it appears in the body, emoji and all. */
  heading: string;
  html: string;
};

export type ArticleDocument = {
  title: string;
  h1: string;
  sections: DocumentSection[];
  recipeCard: DocumentRecipeCard;
  seo: DocumentSeo;
  /** Primary first, then the others — the order WordPress receives them in. */
  categories: string[];
  relatedPosts: number[];
};

/** What `buildArticleDocument` reads. Matches the stored Article row. */
export type ArticleSource = {
  title: string;
  keyword: string;
  content: string;
  recipeCard: unknown;
  editorial: unknown;
  relatedPosts?: number[];
};

const H2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;

/** Strip tags and collapse whitespace, for a heading's plain text. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split the body on its H2s.
 *
 * The heading text is kept exactly as written — the client's headings carry
 * emoji that the WordPress export depends on for section mapping.
 */
export function splitSections(content: string): DocumentSection[] {
  const out: DocumentSection[] = [];
  const matches = [...content.matchAll(H2)];

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    if (current?.index === undefined) continue;
    const next = matches[i + 1];
    const start = current.index + current[0].length;
    const end = next?.index ?? content.length;
    out.push({
      heading: plain(current[1] ?? ""),
      html: content.slice(start, end).trim(),
    });
  }

  return out;
}

/**
 * Split a stored category list into the one primary and the rest.
 *
 * `resolveCategories` already puts the primary first, and the connector writes
 * `categories[0]` as Yoast's primary — so first-is-primary is the existing
 * contract, named here rather than left implicit.
 */
export function splitCategories(categories: string[]): {
  primary: string;
  others: string[];
} {
  const clean = categories.map((c) => c.trim()).filter((c) => c !== "");
  const [primary, ...others] = clean;
  return { primary: primary ?? "", others };
}

/** A comma/newline separated field the author typed, as a clean list. */
function asList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/** The recipe card, in the shape the client's template describes. */
export function toDocumentRecipeCard(
  recipe: RecipeCard,
  fallbackTitle: string,
): DocumentRecipeCard {
  const total =
    recipe.prepMinutes + recipe.cookMinutes + recipe.customMinutes;

  return {
    title: recipe.name.trim() || fallbackTitle.trim(),
    openingSentence: recipe.openingSentence.trim() || recipe.description.trim(),
    recipeYield: recipe.recipeYield,
    estimatedCost: recipe.estimatedCost,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    customTimeLabel: recipe.customTimeLabel,
    customMinutes: recipe.customMinutes,
    totalMinutes: total,
    course: asList(recipe.category),
    cuisine: asList(recipe.cuisine),
    diet: [...recipe.suitableForDiet],
    equipment: [...recipe.equipment],
    // Verbatim, in the author's order.
    ingredients: [...recipe.ingredients],
    instructions: recipe.steps.map((s) => ({ text: s.text, name: s.name })),
    tips: [...recipe.tips],
  };
}

/** The SEO block, resolved once. */
export function toDocumentSeo(
  meta: EditorialMeta,
  keyword: string,
): DocumentSeo {
  const { primary, others } = splitCategories(meta.categories);
  return {
    focusKeyword: keyword.trim(),
    metaDescription: meta.seoDescription.trim(),
    seoTitle: meta.seoTitle.trim(),
    slug: meta.slug.trim(),
    primaryCategory: primary,
    otherCategories: others,
  };
}

/**
 * Assemble the canonical document from the stored article.
 *
 * This is the only place the pieces are put together. Everything downstream
 * takes the result rather than reading `editorial` or `recipeCard` again.
 */
export function buildArticleDocument(source: ArticleSource): ArticleDocument {
  const meta = parseEditorial(source.editorial);
  const recipe = parseRecipe(source.recipeCard);
  const seo = toDocumentSeo(meta, source.keyword);

  return {
    title: source.title,
    // The H1 is the post title: WordPress renders the title as the H1.
    h1: source.title,
    sections: splitSections(source.content),
    recipeCard: toDocumentRecipeCard(recipe, source.title),
    seo,
    categories: [
      ...(seo.primaryCategory === "" ? [] : [seo.primaryCategory]),
      ...seo.otherCategories,
    ],
    relatedPosts: source.relatedPosts ?? [],
  };
}

/**
 * The excerpt WordPress should carry.
 *
 * The client's mapping is explicit: the meta description populates both Yoast
 * and the excerpt. A separately-authored excerpt is only used when there is no
 * meta description to take, so the two can never disagree on a live post.
 */
export function excerptFor(doc: ArticleDocument, storedExcerpt: string): string {
  return doc.seo.metaDescription !== ""
    ? doc.seo.metaDescription
    : storedExcerpt.trim();
}

/** Whether the card has enough to be worth rendering or exporting. */
export function hasRecipe(card: DocumentRecipeCard): boolean {
  return card.ingredients.length > 0 && card.instructions.length > 0;
}

/** Minutes as the card shows them, e.g. "1 hr 5 mins". Empty when unset. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (hrs > 0) parts.push(`${String(hrs)} hr${hrs === 1 ? "" : "s"}`);
  if (mins > 0) parts.push(`${String(mins)} min${mins === 1 ? "" : "s"}`);
  return parts.join(" ");
}
