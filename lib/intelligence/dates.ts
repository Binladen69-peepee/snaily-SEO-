/**
 * Dates that read the same on the server and in the browser.
 *
 * These screens render on Vercel, in UTC, and then hydrate in the reader's own
 * timezone. `toLocaleString()` with no timezone asks the runtime, so the two
 * passes produced different strings for anyone outside UTC and React logged a
 * hydration error on every load — three separate places on Content
 * Intelligence were doing it.
 *
 * Guessing the reader's zone on the server only moves the guess somewhere less
 * visible. The zone is named instead, which is unambiguous for any reader, and
 * a crawl timestamp is read for "how old is this", which UTC answers exactly
 * as well.
 */

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "31 Aug 2026, 12:16 UTC" — when a crawl ran. */
export function formatCrawlTime(value: string | Date): string {
  return `${DATE_TIME.format(new Date(value))} UTC`;
}

/** "31 Aug 2026" — a day, where the time of day carries no meaning. */
export function formatDay(value: string | Date): string {
  return DATE_ONLY.format(new Date(value));
}
