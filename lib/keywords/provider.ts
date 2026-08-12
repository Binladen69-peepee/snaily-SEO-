import { MockKeywordProvider } from "@/lib/keywords/providers/mock";
import { SerpApiProvider } from "@/lib/keywords/providers/serpapi";
import type { KeywordProvider } from "@/lib/keywords/types";

/**
 * Single place where the keyword data source is chosen.
 *
 * SerpApi is used automatically whenever SERPAPI_KEY is set; without a key the
 * app falls back to generated data so nothing breaks. To add another provider,
 * create `lib/keywords/providers/<name>.ts` implementing KeywordProvider and
 * add one branch below — no other file changes.
 */
let instance: KeywordProvider | null = null;
/**
 * The configuration `instance` was built from.
 *
 * The provider holds its key, so a plain memo would keep using an old key for
 * the life of the server instance — and the owner can now replace a key from
 * the Integrations page without a redeploy. Remembering what the instance was
 * built from means a rotated key takes effect on the very next call.
 */
let builtFrom: string | null = null;

export function getKeywordProvider(): KeywordProvider {
  const serpApiKey = process.env.SERPAPI_KEY?.trim();
  const choice = process.env.KEYWORD_PROVIDER ?? (serpApiKey ? "serpapi" : "mock");
  const signature = `${choice}:${serpApiKey ?? ""}`;

  if (instance && builtFrom === signature) return instance;

  switch (choice) {
    case "serpapi":
      instance = serpApiKey
        ? new SerpApiProvider(serpApiKey)
        : new MockKeywordProvider();
      break;
    default:
      instance = new MockKeywordProvider();
  }

  builtFrom = signature;
  return instance;
}
