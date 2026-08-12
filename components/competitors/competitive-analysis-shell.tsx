import { Suspense, type ReactNode } from "react";

import { CASearchBar } from "@/components/competitors/ca-search-bar";
import { CompetitorSubNav } from "@/components/competitors/competitor-sub-nav";

/**
 * Shared Competitive Analysis chrome — same Explorer layout for every tab.
 * Only the content below the search bar changes between tools.
 */
export function CompetitiveAnalysisShell({
  domain = "",
  country = "us",
  children,
  showSearch = true,
}: {
  domain?: string;
  country?: string;
  children: ReactNode;
  /** Hide the domain search bar (e.g. Site Audit uses the project instead). */
  showSearch?: boolean;
}) {
  return (
    <div className="-m-4 space-y-0 bg-muted/40 sm:-m-6">
      <div className="border-b border-border bg-card px-3 pt-3 sm:px-4">
        <h1 className="mb-1 text-lg font-bold tracking-tight">
          Competitive Analysis
        </h1>
        <Suspense
          fallback={
            <div className="h-10 border-b border-border" aria-hidden />
          }
        >
          <CompetitorSubNav domain={domain} />
        </Suspense>
      </div>

      {showSearch ? (
        <Suspense fallback={<div className="h-[3.75rem] border-b border-border bg-card" />}>
          <CASearchBar domain={domain} country={country} />
        </Suspense>
      ) : null}

      <div className="p-3 sm:p-4">{children}</div>
    </div>
  );
}
