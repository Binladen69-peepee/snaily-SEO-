import { DeepDiveView } from "@/components/keywords/deep-dive-view";
import { Badge } from "@/components/ui/badge";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { SOURCES } from "@/lib/keywords/suggest-sources";

export const metadata = { title: "Deep Dive · Snaily SEO" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DeepDivePage({ searchParams }: Props) {
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q : "";
  const provider = getKeywordProvider();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deep Dive</h1>
          <p className="text-sm text-muted-foreground">
            Every phrase real people are offered when they type your keyword,
            across eight search boxes at once.
          </p>
        </div>
        {provider.isMock ? (
          <Badge variant="warning">
            Sample SERP data — add SERPAPI_KEY for live analysis
          </Badge>
        ) : (
          <Badge variant="success">Live autocomplete</Badge>
        )}
      </div>

      <DeepDiveView sources={SOURCES} initialKeyword={q} />
    </div>
  );
}
