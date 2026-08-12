import { KeywordTable } from "@/components/keywords/keyword-table";
import { Pagination } from "@/components/keywords/pagination";
import {
  ErrorState,
  NoResultsState,
  StartState,
} from "@/components/keywords/states";
import { recordSearch } from "@/lib/keywords/history";
import { hasActiveFilters, PER_PAGE } from "@/lib/keywords/params";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { getActiveProject } from "@/lib/projects";
import { ProviderError, type SearchParams } from "@/lib/keywords/types";

/**
 * Async server component. Rendered inside <Suspense> so the page shell and
 * search box paint immediately while results resolve.
 */
export async function Results({ params }: { params: SearchParams }) {
  if (params.keyword.trim() === "") return <StartState />;

  const provider = getKeywordProvider();

  let data;
  try {
    data = await provider.search(params);
    await recordSearch(params.keyword, params.country, data.total);
  } catch (err) {
    const message =
      err instanceof ProviderError
        ? err.message
        : "The keyword data source is unavailable. Please try again.";
    return <ErrorState message={message} />;
  }

  if (data.results.length === 0) {
    return <NoResultsState hasFilters={hasActiveFilters(params.filters)} />;
  }

  // Saving to a list needs the active project; null just disables that action.
  const project = await getActiveProject();
  const totalPages = Math.max(1, Math.ceil(data.total / PER_PAGE));

  return (
    <>
      {/*
        The table keeps a 30rem floor so the columns stay readable, so on a
        phone it scrolls sideways in its own box rather than dragging the whole
        page with it. At xl the pane is wide enough and overflow goes back to
        visible, which is what lets the header row stick while scrolling.
      */}
      <div className="relative overflow-x-auto xl:overflow-x-visible">
        <KeywordTable
          keywords={data.results}
          country={params.country}
          total={data.total}
          projectId={project?.id ?? null}
        />
      </div>

      <div className="px-3 py-3">
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={data.total}
          perPage={PER_PAGE}
        />
      </div>
    </>
  );
}
