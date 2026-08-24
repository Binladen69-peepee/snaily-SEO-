/**
 * Editorial SEO numbers derived from the live draft. Every score is a count or
 * a length check against a documented range — nothing is invented.
 */

import { analyseReadability, LONG_SENTENCE } from "@/lib/drafter/readability";

export type SeoCheck = {
  id: string;
  label: string;
  value: string;
  score: number | null;
  detail: string;
};

const TITLE_MIN = 40;
const TITLE_MAX = 60;
const META_MIN = 120;
const META_MAX = 160;

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function count(html: string, re: RegExp): number {
  return html.match(re)?.length ?? 0;
}

/**
 * Host the project actually publishes to.
 *
 * Internal-link detection used to test for "cinnamonsnail.com" literally,
 * which quietly reported every internal link as external on any other
 * project. The site is a parameter now.
 */
function hostOf(siteUrl: string): string {
  const raw = siteUrl.trim();
  if (raw === "") return "";
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

export function editorialSeo(input: {
  title: string;
  keyword: string;
  html: string;
  seoTitle: string;
  seoDescription: string;
  excerpt: string;
  featured: boolean;
  coveredTerms: number;
  totalTerms: number;
  optimization: number;
  /** The project's own site, so internal links are recognised as internal. */
  siteUrl: string;
  /** True once the recipe card has the fields a rich result needs. */
  recipeValid: boolean | null;
}): SeoCheck[] {
  const html = input.html;
  const title = (input.seoTitle.trim() || input.title).trim();
  const meta = input.seoDescription.trim() || input.excerpt.trim();
  const kw = input.keyword.trim().toLowerCase();
  const hay = `${title}\n${textOf(html)}`.toLowerCase();
  const kwHits = kw === "" ? 0 : hay.split(kw).length - 1;

  const h2 = count(html, /<h2\b/gi);
  const h3 = count(html, /<h3\b/gi);
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const withAlt = imgs.filter((t) => /alt="[^"]+/i.test(t)).length;
  const site = hostOf(input.siteUrl);
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1] ?? "");
  const isInternal = (h: string) =>
    h.startsWith("/") || (site !== "" && h.toLowerCase().includes(site));
  const internal = hrefs.filter(isInternal).length;
  const external = hrefs.filter(
    (h) => /^https?:\/\//i.test(h) && !isInternal(h),
  ).length;
  const hasFaq = /<h2\b[^>]*>[\s\S]*?faq/i.test(html);

  const read = analyseReadability(html);
  const words = read.words;
  const avg = Math.round(read.avgWordsPerSentence);

  const titleLen = title.length;
  const titleScore =
    titleLen === 0
      ? 0
      : titleLen >= TITLE_MIN && titleLen <= TITLE_MAX
        ? 100
        : titleLen < TITLE_MIN
          ? Math.round((titleLen / TITLE_MIN) * 80)
          : Math.max(40, 100 - (titleLen - TITLE_MAX) * 3);

  const metaLen = meta.length;
  const metaScore =
    metaLen === 0
      ? 0
      : metaLen >= META_MIN && metaLen <= META_MAX
        ? 100
        : metaLen < META_MIN
          ? Math.round((metaLen / META_MIN) * 80)
          : Math.max(40, 100 - (metaLen - META_MAX));

  const altScore =
    imgs.length === 0 ? null : Math.round((withAlt / imgs.length) * 100);

  const headingScore = h2 >= 4 ? 100 : h2 === 0 ? 0 : Math.round((h2 / 4) * 100);

  const readScore =
    words < 80
      ? 0
      : avg === 0
        ? 50
        : avg <= 22
          ? 100
          : avg <= 28
            ? 70
            : 40;

  return [
    {
      id: "keyword",
      label: "Primary keyword",
      value: kw === "" ? "—" : `${String(kwHits)}× in draft`,
      score: kw === "" ? null : kwHits > 0 ? 100 : 0,
      detail:
        kw === ""
          ? "No target keyword on this article."
          : kwHits > 0
            ? `“${input.keyword}” appears ${String(kwHits)} time${kwHits === 1 ? "" : "s"}.`
            : `“${input.keyword}” is not in the title or body yet.`,
    },
    {
      id: "coverage",
      label: "Keyword coverage",
      value: `${String(input.coveredTerms)} / ${String(input.totalTerms)}`,
      score: input.totalTerms === 0 ? null : input.optimization,
      detail:
        input.totalTerms === 0
          ? "Research has not produced related terms yet."
          : `${String(input.coveredTerms)} of ${String(input.totalTerms)} related terms appear in the draft.`,
    },
    {
      id: "content",
      label: "Content score",
      value: `${String(input.optimization)}%`,
      score: input.optimization,
      detail: "Weighted coverage of the research term set — same number as the keyword panel.",
    },
    {
      id: "title",
      label: "Title score",
      value: `${String(titleLen)} chars`,
      score: titleScore,
      detail: `SEO title (or post title) should land around ${String(TITLE_MIN)}–${String(TITLE_MAX)} characters. Currently ${String(titleLen)}.`,
    },
    {
      id: "meta",
      label: "Meta score",
      value: metaLen === 0 ? "Missing" : `${String(metaLen)} chars`,
      score: metaScore,
      detail: `Meta description should land around ${String(META_MIN)}–${String(META_MAX)} characters.`,
    },
    {
      id: "headings",
      label: "Heading coverage",
      value: `${String(h2)} H2 · ${String(h3)} H3`,
      score: headingScore,
      detail:
        h2 >= 4
          ? "Enough H2s to match a typical Cinnamon Snail post."
          : "Published posts usually have Why you'll adore, ingredients, method, serving, FAQ.",
    },
    {
      id: "internal",
      label: "Internal links",
      value: String(internal),
      score: null,
      detail: `${String(internal)} link${internal === 1 ? "" : "s"} to this site or a relative path.`,
    },
    {
      id: "external",
      label: "External links",
      value: String(external),
      score: null,
      detail: `${String(external)} link${external === 1 ? "" : "s"} off-site.`,
    },
    {
      id: "alt",
      label: "Image alt coverage",
      value: imgs.length === 0 ? "No images" : `${String(withAlt)} / ${String(imgs.length)}`,
      score: altScore,
      detail:
        imgs.length === 0
          ? "No <img> tags in the draft."
          : `${String(withAlt)} of ${String(imgs.length)} images have alt text.`,
    },
    {
      id: "read",
      label: "Readability",
      value: avg === 0 ? "—" : `${String(avg)} words/sentence`,
      score: readScore,
      detail:
        words < 80
          ? "Not enough prose to judge yet."
          : `Average sentence length is ${String(avg)} words (${String(words)} words, ${String(read.sentences)} sentences).`,
    },
    {
      id: "flesch",
      label: "Reading ease",
      value: read.flesch === null ? "—" : `${String(read.flesch)} · ${read.grade}`,
      // Flesch runs 0–100 already, so it doubles as its own score. Above ~60
      // is the plain-English band most food blogs sit in.
      score: read.flesch === null ? null : Math.max(0, Math.min(100, read.flesch)),
      detail:
        read.flesch === null
          ? "Not enough prose to score yet."
          : `Flesch Reading Ease ${String(read.flesch)} (${read.grade}), from ${String(
              read.words,
            )} words over ${String(read.sentences)} sentences. Syllable counting is a heuristic, so treat the band rather than the decimal as the signal.`,
    },
    {
      id: "sentences",
      label: "Long sentences",
      value: String(read.longSentences.length),
      score:
        read.sentences === 0
          ? null
          : Math.max(
              0,
              Math.round(
                100 - (read.longSentences.length / read.sentences) * 300,
              ),
            ),
      detail:
        read.longSentences.length === 0
          ? `Nothing over ${String(LONG_SENTENCE)} words.`
          : `${String(read.longSentences.length)} of ${String(
              read.sentences,
            )} sentences run past ${String(LONG_SENTENCE)} words.`,
    },
    {
      id: "passive",
      label: "Passive voice",
      value: `${String(read.passivePercent)}%`,
      // Some passive is natural in a method ("the dough is chilled"), so this
      // only starts costing points past a tenth of the sentences.
      score: Math.max(0, Math.min(100, 100 - (read.passivePercent - 10) * 4)),
      detail: `${String(read.passivePercent)}% of sentences use a passive construction (${String(
        read.passive.length,
      )} found). Detection is a heuristic and under-reports irregular verbs.`,
    },
    {
      id: "paragraphs",
      label: "Paragraph length",
      value:
        read.longParagraphs.length === 0
          ? "Good"
          : `${String(read.longParagraphs.length)} long`,
      score:
        read.paragraphs === 0
          ? null
          : Math.max(
              0,
              Math.round(
                100 - (read.longParagraphs.length / read.paragraphs) * 200,
              ),
            ),
      detail:
        read.longParagraphs.length === 0
          ? `Every paragraph is three sentences or fewer, averaging ${String(
              read.avgSentencesPerParagraph,
            )}.`
          : `${String(read.longParagraphs.length)} paragraph${
              read.longParagraphs.length === 1 ? "" : "s"
            } run past three sentences. Published posts average 2.2.`,
    },
    ...(input.recipeValid === null
      ? []
      : [
          {
            id: "recipe",
            label: "Recipe structured data",
            value: input.recipeValid ? "Valid" : "Incomplete",
            score: input.recipeValid ? 100 : 40,
            detail: input.recipeValid
              ? "Name, image and yield are set — this post can earn a recipe rich result."
              : "The recipe card is missing a field Google requires. Open the Recipe tab.",
          },
        ]),
    {
      id: "faq",
      label: "FAQ coverage",
      value: hasFaq ? "Present" : "Missing",
      score: hasFaq ? 100 : 0,
      detail: hasFaq
        ? "An H2 containing “FAQ” is in the draft."
        : "Published posts close with an FAQ block.",
    },
    {
      id: "featured",
      label: "Featured image",
      value: input.featured ? "Set" : "Missing",
      score: input.featured ? 100 : 0,
      detail: input.featured
        ? "A featured image is attached in the meta panel."
        : "Set a featured image before sending to WordPress.",
    },
  ];
}
