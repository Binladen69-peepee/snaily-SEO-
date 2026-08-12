/**
 * Organic click-through rate by ranking position.
 *
 * Published industry averages across large SERP samples. Deliberately one
 * shared table: the SERP panel, competitor tables and traffic estimates all
 * read from here, so the same position never implies two different numbers.
 *
 * This is a curve, not a measurement. Real click-through varies enormously by
 * intent, SERP features and brand — only Search Console reports what a page
 * actually earned.
 */

/** CTR percentage for positions 1–10, index 0 = position 1. */
const CURVE = [27.6, 15.8, 11.0, 8.4, 6.3, 4.9, 3.9, 3.3, 2.7, 2.4];

/** Positions 11–20 flatten out; past page two it is close to nothing. */
const PAGE_TWO = 1.4;
const BEYOND = 0.4;

/**
 * CTR for a position, as a percentage.
 *
 * Accepts fractional positions because Search Console reports averages like
 * 4.7; the value is interpolated between the two neighbouring ranks rather
 * than rounded, so a page that drifts from 4.0 to 4.9 shows the decline.
 */
export function ctrForPosition(position: number): number {
  if (!Number.isFinite(position) || position < 1) return 0;
  if (position > 20) return BEYOND;

  const at = (rank: number): number => {
    if (rank <= 10) return CURVE[rank - 1] ?? BEYOND;
    if (rank <= 20) return PAGE_TWO;
    return BEYOND;
  };

  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return at(low);

  const fraction = position - low;
  return at(low) + (at(high) - at(low)) * fraction;
}

/**
 * Monthly visits a keyword is worth at a given position.
 *
 * Returns null when the position is unknown — an unranked keyword has no
 * traffic estimate, and showing 0 would read as "measured zero".
 */
export function estimateTraffic(
  position: number | null,
  volume: number,
): number | null {
  if (position === null || volume <= 0) return null;
  return Math.round((volume * ctrForPosition(position)) / 100);
}
