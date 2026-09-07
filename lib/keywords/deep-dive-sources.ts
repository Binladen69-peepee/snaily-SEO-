/**
 * Deep Dive source catalogue — no Prisma, safe for client bundles and the
 * merge step. Fetchers live in suggest-sources.ts.
 */

export const SUGGEST_SOURCES = [
  "related",
  "google",
  "bing",
  "youtube",
  "duckduckgo",
  "amazon",
  "ebay",
  "competitors",
  "database",
  "etsy",
  "pinterest",
] as const;

export type DeepDiveSource = (typeof SUGGEST_SOURCES)[number];

export type SourceInfo = {
  id: DeepDiveSource;
  label: string;
  /** One line explaining what the source actually is. */
  note: string;
  /** False when nothing can be fetched; `reason` says why. */
  available: boolean;
  reason?: string;
  /** True when it spends a paid SERP lookup rather than a free endpoint. */
  costsQuota?: boolean;
};

export const SOURCES: SourceInfo[] = [
  {
    id: "related",
    label: "Related Keywords",
    note: "Google's own related searches and People Also Ask for this phrase.",
    available: true,
    costsQuota: true,
  },
  {
    id: "google",
    label: "Google Suggest",
    note: "What Google autocompletes as you type.",
    available: true,
  },
  {
    id: "bing",
    label: "Bing Suggest",
    note: "Bing's autocomplete.",
    available: true,
  },
  {
    id: "youtube",
    label: "YouTube Suggest",
    note: "YouTube search autocomplete — video intent.",
    available: true,
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo Suggest",
    note: "DuckDuckGo's autocomplete.",
    available: true,
  },
  {
    id: "amazon",
    label: "Amazon Suggest",
    note: "Amazon product search autocomplete — buying intent.",
    available: true,
  },
  {
    id: "ebay",
    label: "eBay Suggest",
    note: "eBay search autocomplete — buying intent.",
    available: true,
  },
  {
    id: "competitors",
    label: "Competitors",
    note: "Phrases the top-ranking pages for this keyword target in their own titles and headings.",
    available: true,
    costsQuota: true,
  },
  {
    id: "database",
    label: "Database",
    note: "A licensed keyword database.",
    available: false,
    reason:
      "No keyword database is connected. Volume and CPC across the app are estimated for the same reason.",
  },
  {
    id: "etsy",
    label: "Etsy Suggest",
    note: "Etsy search autocomplete.",
    available: false,
    reason: "Etsy has no public autocomplete endpoint — it returns 404 to anything but its own site.",
  },
  {
    id: "pinterest",
    label: "Pinterest Suggest",
    note: "Pinterest search autocomplete.",
    available: false,
    reason: "Pinterest's typeahead refuses requests without a logged-in session.",
  },
];

export const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export function isSource(value: string): value is DeepDiveSource {
  return SOURCE_BY_ID.has(value as DeepDiveSource);
}

/**
 * How many Deep Dive rows get live Ranking Pages / DA / Est. Links
 * automatically. Filling hundreds of rows would spend SERP quota and
 * sit in the browser for many minutes.
 */
export const AUTO_ENRICH_CAP = 40;
