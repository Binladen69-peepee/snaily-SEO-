import { Suspense } from "react";

import { AnalysisPanel } from "@/components/keywords/analysis-panel";
import { Results } from "@/components/keywords/results";
import { SearchBar } from "@/components/keywords/search-bar";
import { SearchHistoryList } from "@/components/keywords/search-history";
import { ResultsSkeleton } from "@/components/keywords/states";
import { KeywordToolbar } from "@/components/keywords/toolbar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getHistory } from "@/lib/keywords/history";
import { parseSearchParams } from "@/lib/keywords/params";
import { getKeywordProvider } from "@/lib/keywords/provider";

export const metadata = { title: "Keyword Research · Snaily SEO" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function AnalysisSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-28" />
      <Skeleton className="h-56" />
      <Skeleton className="h-96" />
    </div>
  );
}

export default async function KeywordsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const params = parseSearchParams(raw);
  const [history, provider] = await Promise.all([
    getHistory(),
    Promise.resolve(getKeywordProvider()),
  ]);

  const activeFilterCount = Object.keys(params.filters).length;
  const searched = params.keyword.trim() !== "";

  // Re-runs the panels whenever any search input changes.
  const resultsKey = JSON.stringify(params);
  const analysisKey = `${params.keyword}|${params.country}`;

  return (
    /*
     * Full-bleed: the search strip spans the window like KeySearch's, and the
     * two panels scroll independently beneath it. The negative margin cancels
     * the padding the app shell puts on <main>, and 55px is the nav bar's 54px
     * plus its 1px bottom border.
     */
    <div className="-m-4 flex flex-col sm:-m-6 xl:h-[calc(100svh-55px)] xl:overflow-hidden">
      <KeywordToolbar>
        <SearchBar activeFilterCount={activeFilterCount} />

        {/*
          Two independent scroll panes on wide screens; below that the panels
          stack and the page scrolls normally, so nothing is ever trapped in a
          viewport-height box on a phone.
        */}
        <div className="flex flex-col xl:min-h-0 xl:flex-1 xl:flex-row">
          {/* ---------- Left: analysis of the searched keyword ---------- */}
          <div className="relative min-w-0 flex-1 p-3 xl:overflow-y-auto xl:border-r xl:border-border">
            {!searched ? (
              <div className="mx-auto max-w-lg py-16">
                <div className="mb-4 flex flex-wrap justify-center gap-2">
                  {provider.isMock ? (
                    <Badge variant="warning">
                      Sample data — add SERPAPI_KEY for live results
                    </Badge>
                  ) : (
                    <>
                      <Badge variant="success">Live Google results</Badge>
                      {provider.volumeIsEstimated && (
                        <Badge
                          variant="secondary"
                          title="SerpApi returns rankings, not keyword metrics. Volume, CPC and link counts are estimated until a keyword-data source is connected."
                        >
                          Volume &amp; authority estimated
                        </Badge>
                      )}
                    </>
                  )}
                </div>
                <SearchHistoryList items={history} />
              </div>
            ) : (
              <Suspense key={analysisKey} fallback={<AnalysisSkeleton />}>
                <AnalysisPanel params={params} />
              </Suspense>
            )}
          </div>

          {/* ---------- Right: the keyword idea list ---------- */}
          {/*
            `relative` matters: a screen-reader <caption> is absolutely
            positioned, so without a positioned ancestor it resolves against
            the viewport, escapes this pane's clipping, and adds dead scroll
            to the whole document.
          */}
          <div className="relative shrink-0 border-t border-border xl:min-h-0 xl:w-[42%] xl:overflow-y-auto xl:border-t-0 print:hidden">
            <Suspense key={resultsKey} fallback={<ResultsSkeleton />}>
              <Results params={params} />
            </Suspense>
          </div>
        </div>
      </KeywordToolbar>
    </div>
  );
}
