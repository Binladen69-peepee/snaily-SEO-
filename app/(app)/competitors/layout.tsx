import { Suspense, type ReactNode } from "react";

import { CASearchBar } from "@/components/competitors/ca-search-bar";
import { CompetitorSubNav } from "@/components/competitors/competitor-sub-nav";

/**
 * Competitive Analysis chrome, hoisted into a layout.
 *
 * A layout is preserved across navigations between its child routes, so
 * switching tabs swaps only the panel underneath — the heading, tab row and
 * domain box stay mounted and keep their state. Rendering this inside each
 * page instead meant every tab click tore the whole screen down and rebuilt
 * it, which read as a page redirect.
 */
export default function CompetitorsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="-m-4 flex min-h-[calc(100svh-55px)] flex-col bg-muted/40 sm:-m-6">
      <div className="border-b border-border bg-card px-3 pt-3 sm:px-4">
        <h1 className="mb-1 text-lg font-bold tracking-tight">
          Competitive Analysis
        </h1>
        {/* Both read the URL, so they need a Suspense boundary of their own. */}
        <Suspense fallback={<div className="h-10" aria-hidden />}>
          <CompetitorSubNav />
        </Suspense>
      </div>

      <Suspense
        fallback={<div className="h-[3.75rem] border-b border-border bg-card" />}
      >
        <CASearchBar />
      </Suspense>

      <div className="flex-1 p-3 sm:p-4">{children}</div>
    </div>
  );
}
