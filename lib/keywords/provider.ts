import { dataForSeoConfigured } from "@/lib/dataforseo/config";
import { MockKeywordProvider } from "@/lib/keywords/providers/mock";
import { LiveKeywordProvider } from "@/lib/keywords/providers/live";
import { serpApiConfigured } from "@/lib/keywords/serp-api-guard";
import type { KeywordProvider } from "@/lib/keywords/types";

/**
 * Single place where the keyword data source is chosen.
 *
 * LiveKeywordProvider keeps BOTH DataForSEO and SerpApi:
 *   - SERP: DataForSEO primary, SerpApi fallback
 *   - Authority/backlinks: DataForSEO when configured
 *
 * KEYWORD_PROVIDER=mock forces sample data only.
 */
let instance: KeywordProvider | null = null;
let builtFrom: string | null = null;

export function getKeywordProvider(): KeywordProvider {
  const dfs = dataForSeoConfigured();
  const serp = serpApiConfigured();
  const choice =
    process.env.KEYWORD_PROVIDER?.trim() ||
    (dfs || serp ? "live" : "mock");

  // Signature includes which backends are present so rotating keys rebuilds.
  const signature = `${choice}:dfs=${dfs ? "1" : "0"}:serp=${serp ? "1" : "0"}`;

  if (instance && builtFrom === signature) return instance;

  switch (choice) {
    case "mock":
      instance = new MockKeywordProvider();
      break;
    case "serpapi":
    case "dataforseo":
    case "live":
    default:
      instance =
        dfs || serp ? new LiveKeywordProvider() : new MockKeywordProvider();
      break;
  }

  builtFrom = signature;
  return instance;
}
