import {
  matchesTerms,
  SUGGEST_SOURCES,
  type Keyword,
  type KeywordDetail,
  type KeywordProvider,
  type SearchIntent,
  type SearchMode,
  type SearchParams,
  type SearchResult,
  type SerpResult,
  type Suggestions,
  type SuggestSource,
} from "@/lib/keywords/types";

/**
 * Mock provider. Generates realistic, deterministic keyword data.
 *
 * Deterministic matters: the same query always returns the same numbers, so
 * pagination, filtering and the detail page stay consistent across requests —
 * exactly how a real provider behaves.
 */

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  // FNV-1a's last step is a multiply, so seeds differing only in their final
  // character land within a few percent of each other in the high bits — which
  // is exactly what `rand` reads. Since rows and months are seeded `…|b0`,
  // `…|b1`, `…|t0`, `…|t1`, that made every SERP row and every month of a trend
  // come out nearly identical. Finalise with fmix32 so one character avalanches.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;

  return h >>> 0;
}

/** Deterministic 0–1 from a seed string. */
function rand(seed: string): number {
  return hash(seed) / 4294967295;
}

function randInt(seed: string, min: number, max: number): number {
  return Math.floor(min + rand(seed) * (max - min + 1));
}

const MODIFIERS = [
  "best",
  "top",
  "cheap",
  "free",
  "online",
  "near me",
  "for beginners",
  "reviews",
  "vs",
  "alternatives",
  "software",
  "tools",
  "guide",
  "tutorial",
  "examples",
  "tips",
  "checklist",
  "template",
  "pricing",
  "comparison",
  "2026",
  "for small business",
  "step by step",
  "ideas",
  "services",
  "companies",
  "app",
  "course",
  "strategy",
  "benefits",
];

const QUESTION_PREFIXES = [
  "what is",
  "how to",
  "why is",
  "when to",
  "where to",
  "who needs",
  "is",
  "does",
  "can you",
  "how much does",
  "how long does",
  "what are the best",
];

const TRANSACTIONAL = ["buy", "price", "pricing", "cheap", "order", "discount"];
const COMMERCIAL = [
  "best",
  "top",
  "review",
  "reviews",
  "vs",
  "comparison",
  "alternatives",
  "software",
  "tools",
  "services",
  "companies",
];
const NAVIGATIONAL = ["login", "sign in", "download", "app", "official"];

function detectIntent(keyword: string): SearchIntent {
  const k = keyword.toLowerCase();
  if (QUESTION_PREFIXES.some((p) => k.startsWith(p))) return "informational";
  if (TRANSACTIONAL.some((t) => k.includes(t))) return "transactional";
  if (NAVIGATIONAL.some((n) => k.includes(n))) return "navigational";
  if (COMMERCIAL.some((c) => k.includes(c))) return "commercial";
  return "informational";
}

/** Longer, more specific phrases get less volume and are easier to rank. */
function buildKeyword(phrase: string, country: string): Keyword {
  const seed = `${phrase}|${country}`;
  const words = phrase.trim().split(/\s+/).length;

  const base = randInt(`${seed}|v`, 200, 74000);
  const volume = Math.max(10, Math.round(base / Math.pow(words, 1.35) / 10) * 10);

  const intent = detectIntent(phrase);

  // Difficulty rises with volume, falls with specificity.
  const volumeFactor = Math.min(1, volume / 40000);
  const lengthPenalty = Math.min(0.45, (words - 1) * 0.09);
  const noise = rand(`${seed}|d`) * 0.28 - 0.14;
  const difficulty = Math.min(
    97,
    Math.max(3, Math.round((volumeFactor * 0.85 + 0.22 - lengthPenalty + noise) * 100)),
  );

  // Commercial and transactional terms carry higher CPC.
  const intentMultiplier =
    intent === "transactional" ? 3.1 : intent === "commercial" ? 2.2 : 1;
  const cpc =
    Math.round(rand(`${seed}|c`) * 7.5 * intentMultiplier * 100) / 100;

  const competition =
    Math.round(
      Math.min(1, (difficulty / 100) * 0.7 + rand(`${seed}|k`) * 0.3) * 100,
    ) / 100;

  // Seasonal-looking 12-month curve.
  const amplitude = rand(`${seed}|a`) * 0.35;
  const offset = randInt(`${seed}|o`, 0, 11);
  const trend = Array.from({ length: 12 }, (_, i) => {
    const wave = Math.sin(((i + offset) / 12) * Math.PI * 2) * amplitude;
    const jitter = rand(`${seed}|t${String(i)}`) * 0.12 - 0.06;
    return Math.max(10, Math.round((volume * (1 + wave + jitter)) / 10) * 10);
  });

  return {
    keyword: phrase,
    volume,
    difficulty,
    cpc,
    competition,
    trend,
    intent,
    results: randInt(`${seed}|r`, 120_000, 89_000_000),
  };
}

/**
 * Builds the idea set for a seed, before filtering.
 *
 * The mode changes which phrases exist at all, the way a real provider's match
 * type does — not just how the same list is sorted.
 *
 *   exact     phrases containing the seed contiguously
 *   questions question-led phrases only
 *   broad     exact set plus word-level recombinations (seed words split up)
 *   related   the balanced default
 */
function generateIdeas(
  seed: string,
  country: string,
  mode: SearchMode = "related",
): Keyword[] {
  const term = seed.trim().toLowerCase();
  const words = term.split(/\s+/).filter((w) => w !== "");

  const exact = new Set<string>([term]);
  for (const m of MODIFIERS) {
    exact.add(`${m} ${term}`);
    exact.add(`${term} ${m}`);
  }
  for (const m of MODIFIERS.slice(0, 12)) {
    exact.add(`${m} ${term} for small business`);
    exact.add(`${m} ${term} 2026`);
  }

  const questions = new Set<string>();
  for (const q of QUESTION_PREFIXES) {
    questions.add(`${q} ${term}`);
    questions.add(`${q} ${term} work`);
  }

  let phrases: Set<string>;

  switch (mode) {
    case "exact":
      phrases = exact;
      break;

    case "questions":
      phrases = questions;
      break;

    case "broad": {
      // Broad match also surfaces phrases where the seed words are separated.
      phrases = new Set([...exact, ...questions]);
      if (words.length > 1) {
        const head = words[0]!;
        const tail = words[words.length - 1]!;
        for (const m of MODIFIERS) {
          phrases.add(`${head} ${m} ${tail}`);
          phrases.add(`${head} ${m}`);
          phrases.add(`${m} ${tail}`);
        }
      } else {
        for (const a of MODIFIERS.slice(0, 14)) {
          for (const b of MODIFIERS.slice(0, 6)) {
            if (a !== b) phrases.add(`${a} ${term} ${b}`);
          }
        }
      }
      break;
    }

    default:
      phrases = new Set([...exact, ...questions]);
  }

  return [...phrases]
    .map((p) => buildKeyword(p, country))
    .sort((a, b) => b.volume - a.volume);
}

function applyFilters(
  keywords: Keyword[],
  f: SearchParams["filters"],
): Keyword[] {
  return keywords.filter((k) => {
    const words = k.keyword.trim().split(/\s+/).length;

    if (f.volumeMin !== undefined && k.volume < f.volumeMin) return false;
    if (f.volumeMax !== undefined && k.volume > f.volumeMax) return false;
    if (f.difficultyMin !== undefined && k.difficulty < f.difficultyMin)
      return false;
    if (f.difficultyMax !== undefined && k.difficulty > f.difficultyMax)
      return false;
    if (f.cpcMin !== undefined && k.cpc < f.cpcMin) return false;
    if (f.cpcMax !== undefined && k.cpc > f.cpcMax) return false;
    if (f.wordsMin !== undefined && words < f.wordsMin) return false;
    if (f.wordsMax !== undefined && words > f.wordsMax) return false;
    if (f.intent !== undefined && k.intent !== f.intent) return false;
    if (
      f.contains !== undefined &&
      f.contains !== "" &&
      !matchesTerms(k.keyword, f.contains)
    )
      return false;
    if (
      f.excludes !== undefined &&
      f.excludes !== "" &&
      matchesTerms(k.keyword, f.excludes)
    )
      return false;
    return true;
  });
}

const DOMAINS = [
  "wikipedia.org",
  "hubspot.com",
  "forbes.com",
  "medium.com",
  "reddit.com",
  "shopify.com",
  "semrush.com",
  "moz.com",
  "youtube.com",
  "quora.com",
  "linkedin.com",
  "techradar.com",
  "zapier.com",
  "notion.so",
  "g2.com",
];

function buildSerp(keyword: string, country: string): SerpResult[] {
  const seed = `${keyword}|${country}|serp`;
  const slug = keyword.replace(/\s+/g, "-").toLowerCase();

  return Array.from({ length: 10 }, (_, i) => {
    const position = i + 1;
    const domain = DOMAINS[randInt(`${seed}|d${String(i)}`, 0, DOMAINS.length - 1)]!;

    // Authority generally decreases down the page, with realistic exceptions.
    const domainAuthority = Math.max(
      12,
      Math.min(
        98,
        Math.round(88 - position * 4 + (rand(`${seed}|a${String(i)}`) * 26 - 13)),
      ),
    );

    // A page is usually weaker than the site that hosts it.
    const pageAuthority = Math.max(
      8,
      Math.min(
        95,
        Math.round(domainAuthority - randInt(`${seed}|pa${String(i)}`, 4, 28)),
      ),
    );

    // Big sites have far more site-wide links than any single page.
    const domainLinkingDomains = randInt(
      `${seed}|dld${String(i)}`,
      2_000,
      7_500_000,
    );
    const pageLinkingDomains = randInt(`${seed}|pld${String(i)}`, 0, 2_600);

    // Only some results actually target the keyword in their URL.
    const keywordInUrl = rand(`${seed}|kiu${String(i)}`) > 0.72;

    return {
      position,
      title: `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} — ${
        ["Complete Guide", "Everything You Need to Know", "Best Options", "Explained", "Top Picks"][
          randInt(`${seed}|t${String(i)}`, 0, 4)
        ]!
      }`,
      url: keywordInUrl
        ? `https://${domain}/${slug}`
        : `https://${domain}/blog/${randInt(`${seed}|id${String(i)}`, 1000, 9999).toString()}`,
      domain,
      favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
      description: `Learn about ${keyword}. Practical advice, comparisons and examples to help you decide what works best for your situation.`,
      pageAuthority,
      domainAuthority,
      pageLinkingDomains,
      domainLinkingDomains,
      authority: Math.max(
        5,
        Math.min(100, domainAuthority + randInt(`${seed}|au${String(i)}`, -8, 8)),
      ),
      backlinks: randInt(`${seed}|b${String(i)}`, 40, 240_000),
      keywordInUrl,
      wordCount: randInt(`${seed}|w${String(i)}`, 700, 4800),
    };
  });
}

/**
 * Per-engine autocomplete. Each engine draws from the same modifier pool but
 * with its own offset and length, so the columns overlap without being
 * identical — which is how the real autocomplete endpoints behave.
 */
const SOURCE_FLAVOUR: Record<SuggestSource, string[]> = {
  google: ["", "for beginners", "and make money", "free", "website", "reddit"],
  bing: ["", "2026", "for free", "step by step", "on wordpress", "video"],
  yahoo: ["", "site", "page", "post", "or vlog", "easy"],
};

function buildSuggestions(keyword: string, country: string): Suggestions {
  const term = keyword.trim().toLowerCase();
  const out = {} as Suggestions;

  for (const source of SUGGEST_SOURCES) {
    const seed = `${term}|${country}|${source}`;
    const count = randInt(`${seed}|n`, 10, 16);
    const phrases = new Set<string>();

    for (const flavour of SOURCE_FLAVOUR[source]) {
      phrases.add(flavour === "" ? term : `${term} ${flavour}`);
    }

    let cursor = randInt(`${seed}|start`, 0, MODIFIERS.length - 1);
    while (phrases.size < count) {
      const modifier = MODIFIERS[cursor % MODIFIERS.length]!;
      phrases.add(
        rand(`${seed}|side${String(cursor)}`) > 0.65
          ? `${modifier} ${term}`
          : `${term} ${modifier}`,
      );
      cursor++;
    }

    out[source] = [...phrases].slice(0, count);
  }

  return out;
}

export class MockKeywordProvider implements KeywordProvider {
  readonly name = "mock";
  readonly isMock = true;
  readonly volumeIsEstimated = true;

  search(params: SearchParams): Promise<SearchResult> {
    const { keyword, country, mode, filters, page, perPage } = params;

    if (keyword.trim() === "") {
      return Promise.resolve({ keyword, total: 0, results: [] });
    }

    const all = applyFilters(generateIdeas(keyword, country, mode), filters);
    const start = (page - 1) * perPage;

    return Promise.resolve({
      keyword,
      total: all.length,
      results: all.slice(start, start + perPage),
    });
  }

  suggest(keyword: string, country: string): Promise<Suggestions> {
    return Promise.resolve(buildSuggestions(keyword, country));
  }

  analyze(
    keywords: string[],
    country: string,
    language: string,
  ): Promise<Keyword[]> {
    void language;
    // Same generator as search, so a keyword shows identical metrics in both.
    return Promise.resolve(
      keywords.map((k) => buildKeyword(k.trim().toLowerCase(), country)),
    );
  }

  detail(
    keyword: string,
    country: string,
    language: string,
  ): Promise<KeywordDetail> {
    void language;
    const base = buildKeyword(keyword.trim().toLowerCase(), country);
    const ideas = generateIdeas(keyword, country);

    return Promise.resolve({
      ...base,
      related: ideas
        .filter((k) => k.keyword !== base.keyword)
        .slice(0, 10),
      questions: ideas
        .filter((k) =>
          QUESTION_PREFIXES.some((p) => k.keyword.startsWith(p)),
        )
        .slice(0, 10),
      serp: buildSerp(keyword, country),
    });
  }
}
