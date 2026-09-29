/**
 * Country → DataForSEO location_code for Google organic SERP.
 *
 * Codes from DataForSEO location list (ISO 3166-1 numeric).
 * "any" defaults to US because the Live Advanced endpoint requires a location.
 */

const LOCATION_CODES: Record<string, number> = {
  // North America
  us: 2840,
  ca: 2124,
  mx: 2484,

  // Europe
  uk: 2826,
  gb: 2826,
  de: 2276,
  fr: 2250,
  es: 2724,
  it: 2380,
  nl: 2528,
  be: 2056,
  at: 2040,
  ch: 2756,
  se: 2752,
  no: 2578,
  dk: 2208,
  fi: 2246,
  ie: 2372,
  pt: 2620,
  pl: 2616,
  cz: 2203,
  ro: 2642,
  hu: 2348,
  gr: 2300,
  bg: 2100,
  hr: 2191,
  sk: 2703,
  ua: 2804,
  rs: 2688,
  ru: 2643,
  tr: 2792,

  // Asia & Pacific
  in: 2356,
  au: 2036,
  nz: 2554,
  jp: 2392,
  kr: 2410,
  cn: 2156,
  hk: 2344,
  tw: 2158,
  sg: 2702,
  my: 2458,
  id: 2360,
  th: 2764,
  ph: 2608,
  vn: 2704,
  pk: 2586,
  bd: 2050,

  // Middle East
  ae: 2784,
  sa: 2682,
  il: 2376,
  eg: 2818,
  qa: 2634,
  kw: 2414,
  bh: 2048,
  om: 2512,

  // South America
  br: 2076,
  ar: 2032,
  co: 2170,
  cl: 2152,
  pe: 2604,

  // Africa
  za: 2710,
  ng: 2566,
  ke: 2404,
  gh: 2288,
};

export function dataForSeoLocationCode(country: string): number {
  const key = country.trim().toLowerCase();
  if (key === "" || key === "any") return LOCATION_CODES.us!;
  return LOCATION_CODES[key] ?? LOCATION_CODES.us!;
}

export function dataForSeoLanguageCode(language: string): string {
  const lang = language.trim().toLowerCase();
  if (lang === "" || lang.length > 10) return "en";
  // Accept "en" or "en-US" style.
  return lang.split(/[-_]/)[0] || "en";
}
