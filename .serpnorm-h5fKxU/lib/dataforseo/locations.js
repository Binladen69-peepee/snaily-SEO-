/**
 * Country → DataForSEO location_code for Google organic SERP.
 *
 * Codes from DataForSEO location list (ISO-aligned). "any" defaults to US
 * because the Live Advanced endpoint requires a location.
 */
const LOCATION_CODES = {
    us: 2840,
    uk: 2826,
    gb: 2826,
    ca: 2124,
    au: 2036,
    de: 2276,
    fr: 2250,
    es: 2724,
    in: 2356,
};
export function dataForSeoLocationCode(country) {
    const key = country.trim().toLowerCase();
    if (key === "" || key === "any")
        return LOCATION_CODES.us;
    return LOCATION_CODES[key] ?? LOCATION_CODES.us;
}
export function dataForSeoLanguageCode(language) {
    const lang = language.trim().toLowerCase();
    if (lang === "" || lang.length > 10)
        return "en";
    // Accept "en" or "en-US" style.
    return lang.split(/[-_]/)[0] || "en";
}
