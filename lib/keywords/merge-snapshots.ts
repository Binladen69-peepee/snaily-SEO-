/**
 * Folds a batch of SERP snapshots back into the rows that asked for them.
 *
 * Pure and separate from the view because it carries the one bug that makes a
 * bulk run look broken: the enrich endpoint lowercases every keyword before
 * using it as a result key, while a row keeps whatever casing the search box
 * returned. Matching those two directly means a row called "Superman Cost To
 * Make" never finds "superman cost to make", and the column stays empty with
 * no error anywhere — so the lookup is case-folded on both sides here, once.
 */

export type SnapshotLike = {
  difficulty: number | null;
};

export type RowLike<S extends SnapshotLike> = {
  keyword: string;
  difficulty: number;
  serp: S | null;
};

export function mergeSnapshots<S extends SnapshotLike, R extends RowLike<S>>(
  rows: R[],
  found: Record<string, S | null>,
): R[] {
  // Built once per batch rather than per row: a 25-key object scanned across
  // several hundred rows is the difference between linear and quadratic.
  const byKeyword = new Map<string, S | null>();
  for (const [key, value] of Object.entries(found)) {
    byKeyword.set(key.trim().toLowerCase(), value);
  }

  return rows.map((row) => {
    const snapshot = byKeyword.get(row.keyword.trim().toLowerCase());
    if (snapshot === undefined || snapshot === null) return row;
    return {
      ...row,
      serp: snapshot,
      // A difficulty read off the real page beats the estimate on the row.
      difficulty: snapshot.difficulty ?? row.difficulty,
    };
  });
}

/** Rows still missing their measured columns, in table order. */
export function missingSnapshots<S extends SnapshotLike, R extends RowLike<S>>(
  rows: R[],
): string[] {
  return rows.filter((r) => r.serp === null).map((r) => r.keyword);
}
