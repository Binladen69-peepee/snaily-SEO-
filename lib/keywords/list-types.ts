import type { SearchIntent } from "@/lib/keywords/types";

/** Shape stored in KeywordList.keywords (Json). */
export type ListKeyword = {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition: number;
  intent: SearchIntent;
  opportunity: number;
  addedAt: string | Date;
};

export function parseListKeywords(value: unknown): ListKeyword[] {
  if (!Array.isArray(value)) return [];
  return value as ListKeyword[];
}
