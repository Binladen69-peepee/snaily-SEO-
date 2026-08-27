/**
 * Refusing a cuisine the article does not support.
 *
 * Categories were validated for *existence* and never for *truth*. "Vegan Thai
 * Recipes" is a real shelf on this site, so a Vietnamese bánh mì filed under it
 * passed every check and went out. The draft that prompted this carried Mexican,
 * Thai and Italian; the word "Vietnamese" appears five times in its own text and
 * the site has a Vietnamese shelf with twenty-seven posts on it.
 *
 * The error then compounds: the recipe card derives its cuisine from the
 * categories, so one wrong shelf becomes a wrong cuisine in structured data,
 * which is a factual claim about the dish published to Google.
 *
 * So a cuisine category has to be corroborated by the article itself. Two
 * different thresholds, because keeping and adding are different acts:
 *
 *   KEEP  a cuisine the model chose, if the text mentions it at all. The model
 *         choosing it is already one signal; one mention is the second.
 *   ADD   a cuisine the model missed, only on repeated mention. Putting a post
 *         on a shelf nobody asked for needs conviction, not a passing word.
 *
 * A cuisine with no support is dropped and nothing replaces it. A post with no
 * cuisine category is merely less filed; a post on the wrong one is wrong.
 *
 * Course categories (Mains, Sides, Desserts) are untouched — they make no claim
 * about where a dish comes from.
 */

import type { SiteTerm } from "@/lib/drafter/categories";
import { classifyHeading } from "@/lib/wordpress/sections";

/**
 * Cuisines this site files by, longest first.
 *
 * Longest-first matters: "tex mex" must be tested before "mexican", or a
 * Tex-Mex category matches as Mexican and the distinction the site draws
 * between two separate shelves is lost.
 */
const CUISINE_TERMS = [
  "middle eastern",
  "tex mex",
  "vietnamese",
  "indonesian",
  "mediterranean",
  "portuguese",
  "ethiopian",
  "caribbean",
  "brazilian",
  "moroccan",
  "filipino",
  "malaysian",
  "japanese",
  "lebanese",
  "peruvian",
  "hawaiian",
  "jamaican",
  "american",
  "mexican",
  "italian",
  "chinese",
  "spanish",
  "swedish",
  "turkish",
  "persian",
  "russian",
  "african",
  "british",
  "german",
  "jewish",
  "korean",
  "polish",
  "french",
  "indian",
  "greek",
  "cuban",
  "cajun",
  "thai",
];

/** Lower-cased, punctuation flattened, hyphens treated as spaces. */
function flatten(value: string): string {
  return ` ${value
    .toLowerCase()
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * The cuisine a site category denotes, or null when it names a course.
 *
 * "Vietnamese Vegan Recipes" -> vietnamese. "Mains" -> null.
 */
export function cuisineOf(categoryName: string): string | null {
  const hay = flatten(categoryName);
  for (const term of CUISINE_TERMS) {
    if (hay.includes(` ${term} `)) return term;
  }
  return null;
}

/** How many times the article refers to a cuisine, as whole words. */
export function mentions(text: string, cuisine: string): number {
  const hay = flatten(text);
  const needle = ` ${cuisine} `;
  let count = 0;
  let from = 0;
  for (;;) {
    // Overlapping search: the trailing space of one match is the leading
    // space of the next when two mentions are adjacent.
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length - 1;
  }
  return count;
}

/**
 * The article's own words about its own dish.
 *
 * Two parts of a post exist to name *other* recipes, and both were being read
 * as evidence about this one. A mushroom stroganoff was nearly filed as Turkish
 * because its serving ideas suggest "Bazlama (Turkish Flatbread Recipe)" —
 * a fact about the flatbread, not the stroganoff.
 *
 * So anchor text goes (it labels a link to something else), and the serving and
 * related sections go with it. What remains is the post describing its own
 * subject: the intro, the ingredients, the method.
 */
export function evidenceFrom(input: {
  title: string;
  keyword: string;
  /** The author's untouched recipe paste. */
  recipe: string;
  /** The article body, as HTML. */
  html: string;
}): string {
  /*
   * Split on H2s and keep only the sections that describe THIS dish.
   *
   * Serving ideas and the closing round-up exist to name other recipes, and
   * reading them as evidence nearly filed a mushroom stroganoff as Turkish on
   * the strength of "Bazlama (Turkish Flatbread Recipe)" in its serving
   * suggestions. Tips and FAQs wander too.
   *
   * Splitting is used rather than cutting from the first matching heading,
   * because that depended on one regex matching one heading in one order. This
   * reads every heading and decides each on its own.
   */
  const parts = input.html.split(/(?=<h2\b)/i);

  const kept = parts.filter((part) => {
    const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(part);
    // Prose before the first heading is the intro: always about this dish.
    if (heading === null) return true;
    const key = classifyHeading(heading[1]?.replace(/<[^>]+>/g, "") ?? "");
    return key !== "serving" && key !== "related" && key !== "tips" && key !== "faqs";
  });

  const body = kept
    .join(" ")
    // Anchor text labels a link to another recipe.
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return [input.title, input.keyword, input.recipe, body].join("\n");
}

export type GateResult = {
  /** Categories to send to WordPress, primary first. */
  categories: string[];
  /** Cuisine categories removed for lack of support, with the reason. */
  dropped: { name: string; cuisine: string }[];
  /** A cuisine category added because the article clearly argued for it. */
  added: string | null;
};

/**
 * Corroboration needed to keep a cuisine the model already chose.
 *
 * One mention anywhere in the article is enough, because the model choosing it
 * is already the first signal and this is the second.
 */
const KEEP_MENTIONS = 1;

/**
 * Corroboration needed to ADD a cuisine nobody chose.
 *
 * Body prose is not admissible here at all — only the title, the keyword and
 * the author's own recipe. A post's prose names other dishes constantly: a
 * mushroom stroganoff mentions "Bazlama (Turkish Flatbread Recipe)" in its
 * intro and again in its serving ideas, which is twice, which on any
 * body-inclusive rule is enough to file a Russian dish as Turkish.
 *
 * What a dish IS lives in its name, its keyword and its recipe. What it goes
 * WITH lives in the prose. Only the former can put a post on a cuisine shelf.
 */
const ADD_MENTIONS = 1;

/**
 * Drop unsupported cuisine categories, and add the one the article argues for.
 *
 * `evidence` should be everything the article actually says — title, keyword,
 * the author's recipe and the body — because a bánh mì post says "Vietnamese"
 * in its prose whether or not the model noticed.
 */
export function gateCuisines(
  chosen: string[],
  siteCategories: SiteTerm[],
  evidence: string,
  /**
   * The dish's own identity: title, keyword and the author's recipe.
   * Defaults to the full evidence, which is the permissive reading — callers
   * that can tell the two apart should.
   */
  identity: string = evidence,
): GateResult {
  const dropped: { name: string; cuisine: string }[] = [];
  const kept: string[] = [];

  for (const name of chosen) {
    const cuisine = cuisineOf(name);
    if (cuisine === null) {
      // A course, not a claim about origin. Untouched.
      kept.push(name);
      continue;
    }
    if (mentions(evidence, cuisine) >= KEEP_MENTIONS) {
      kept.push(name);
      continue;
    }
    dropped.push({ name, cuisine });
  }

  /*
   * Only look for a replacement when every cuisine the model picked was wrong.
   * If one survived, the article already sits on a cuisine shelf and a second
   * one is noise.
   */
  let added: string | null = null;
  const hasCuisine = kept.some((name) => cuisineOf(name) !== null);

  if (!hasCuisine) {
    let best: { name: string; score: number } | null = null;
    for (const term of siteCategories) {
      const cuisine = cuisineOf(term.name);
      if (cuisine === null) continue;
      // Identity only. Prose mentions other dishes; a name does not.
      const score = mentions(identity, cuisine);
      if (score < ADD_MENTIONS) continue;
      if (best === null || score > best.score) {
        best = { name: term.name, score };
      }
    }
    if (best !== null) {
      added = best.name;
      kept.push(best.name);
    }
  }

  return { categories: kept, dropped, added };
}
