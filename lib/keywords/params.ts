import {
  INTENTS,
  SEARCH_MODES,
  type KeywordFilters,
  type SearchIntent,
  type SearchMode,
} from "@/lib/keywords/types";

export const PER_PAGE = 25;

type Raw = Record<string, string | string[] | undefined>;

function str(raw: Raw, key: string): string | undefined {
  const v = raw[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s !== undefined && s !== "" ? s : undefined;
}

function num(raw: Raw, key: string): number | undefined {
  const s = str(raw, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Reads filter + pagination state out of the URL. The URL is the source of truth. */
export function parseSearchParams(raw: Raw) {
  const intentRaw = str(raw, "intent");
  const intent =
    intentRaw !== undefined && INTENTS.includes(intentRaw as SearchIntent)
      ? (intentRaw as SearchIntent)
      : undefined;

  const filters: KeywordFilters = {
    ...(num(raw, "volMin") !== undefined && { volumeMin: num(raw, "volMin")! }),
    ...(num(raw, "volMax") !== undefined && { volumeMax: num(raw, "volMax")! }),
    ...(num(raw, "kdMin") !== undefined && { difficultyMin: num(raw, "kdMin")! }),
    ...(num(raw, "kdMax") !== undefined && { difficultyMax: num(raw, "kdMax")! }),
    ...(num(raw, "cpcMin") !== undefined && { cpcMin: num(raw, "cpcMin")! }),
    ...(num(raw, "cpcMax") !== undefined && { cpcMax: num(raw, "cpcMax")! }),
    ...(num(raw, "words") !== undefined && { wordsMin: num(raw, "words")! }),
    ...(num(raw, "wordsMax") !== undefined && { wordsMax: num(raw, "wordsMax")! }),
    ...(intent !== undefined && { intent }),
    ...(str(raw, "contains") !== undefined && { contains: str(raw, "contains")! }),
    ...(str(raw, "excludes") !== undefined && { excludes: str(raw, "excludes")! }),
  };

  const pageNum = num(raw, "page") ?? 1;

  const modeRaw = str(raw, "mode");
  const mode: SearchMode =
    modeRaw !== undefined && SEARCH_MODES.includes(modeRaw as SearchMode)
      ? (modeRaw as SearchMode)
      : "related";

  return {
    keyword: str(raw, "q") ?? "",
    country: str(raw, "country") ?? "us",
    language: str(raw, "lang") ?? "en",
    mode,
    filters,
    page: Math.max(1, Math.floor(pageNum)),
    perPage: PER_PAGE,
  };
}

export function hasActiveFilters(filters: KeywordFilters): boolean {
  return Object.keys(filters).length > 0;
}
