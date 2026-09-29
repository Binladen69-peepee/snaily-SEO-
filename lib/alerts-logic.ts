export type RankMovementKind = "lost" | "drop" | "gain";

export function classifyRankMovement(
  previousRank: number | null,
  currentRank: number | null,
): RankMovementKind | null {
  if (previousRank != null && currentRank == null) return "lost";
  if (previousRank != null && currentRank != null && currentRank - previousRank >= 5) {
    return "drop";
  }
  if (previousRank != null && currentRank != null && previousRank - currentRank >= 5) {
    return "gain";
  }
  if (previousRank == null && currentRank != null && currentRank <= 10) return "gain";
  return null;
}

export type AlertCopyRow = {
  keyword: string;
  kind: string;
  previousRank: number | null;
  currentRank: number | null;
};

export type RankAlertRow = AlertCopyRow & {
  id: string;
  createdAt: string;
};

export function alertCopy(row: AlertCopyRow): string {
  if (row.kind === "lost") {
    return `${row.keyword} dropped out of the top 100 (was #${String(row.previousRank ?? "unranked")})`;
  }
  if (row.kind === "drop") {
    return `${row.keyword} fell from #${String(row.previousRank)} to #${String(row.currentRank)}`;
  }
  return `${row.keyword} rose to #${String(row.currentRank ?? "—")}${
    row.previousRank != null ? ` (was #${String(row.previousRank)})` : ""
  }`;
}
