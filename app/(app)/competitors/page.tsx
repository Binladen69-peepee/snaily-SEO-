import { Target } from "lucide-react";
import { Suspense } from "react";

import { CASearchBar } from "@/components/competitors/ca-search-bar";
import { ExplorerDashboard } from "@/components/competitors/explorer-dashboard";
import { ExplorerLoading } from "@/components/competitors/explorer-loading";
import { getSession } from "@/lib/auth";
import { buildExplorerReport, normalizeDomain } from "@/lib/competitors";
import { getDomainOverview, parseRange } from "@/lib/domain-overview";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Competitor Explorer · Snaily SEO" };

/** Crawl + mentions + cache scan can exceed the default serverless slice. */
export const maxDuration = 60;

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(v: string | string[] | undefined, fallback: string): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() || fallback;
}

async function Report({
  domain,
  country,
  projectId,
  projectDomain,
  userId,
  range,
}: {
  domain: string;
  country: string;
  projectId: string | null;
  projectDomain: string | null;
  userId: string | null;
  range: ReturnType<typeof parseRange>;
}) {
  try {
    /*
     * The overview reads rows we already have, so it never delays the report —
     * but it is scoped to whoever is signed in, and only returns anything when
     * the searched domain is their own connected property.
     */
    const [report, overview] = await Promise.all([
      buildExplorerReport(domain, country, projectId, projectDomain),
      getDomainOverview(domain, userId, range),
    ]);

    return <ExplorerDashboard report={report} overview={overview} />;
  } catch (err) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
      >
        <p className="font-medium text-destructive">
          Could not analyse {domain}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {err instanceof Error
            ? err.message
            : "The site could not be reached."}{" "}
          Check the domain is spelled correctly and reachable over HTTPS.
        </p>
      </div>
    );
  }
}

export default async function CompetitorsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const country = first(raw.country, "us");
  const range = parseRange(first(raw.range, "30d"));

  const [project, session] = await Promise.all([
    getActiveProject(),
    getSession(),
  ]);
  const domain = normalizeDomain(first(raw.domain, ""));
  const projectDomain = project ? normalizeDomain(project.url) : null;

  return (
    /*
     * Full bleed. The negative margin cancels the padding the app shell puts
     * on <main>, so the search bar sits flush under the nav and the cards use
     * the whole window — 57px is the nav's 56px plus its 1px border.
     */
    <div className="app-bleed -my-3 flex min-h-[calc(100svh-57px)] flex-col bg-muted/40 sm:-my-4 md:-my-6">
      <CASearchBar target="/competitors" variant="bar" />

      <div className="flex-1 p-3 sm:p-4">
        {domain === "" ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <Target className="size-10 text-primary/50" aria-hidden />
            <p className="mt-3 text-base font-semibold">
              Enter a domain to explore it
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Search any domain for organic keywords, estimated domain strength,
              backlink signals and competitors found in SERPs. Your own
              connected site also returns measured traffic from Search Console.
            </p>
            {projectDomain && (
              <a
                href={`/competitors?domain=${encodeURIComponent(projectDomain)}`}
                className="mt-4 text-sm font-semibold text-primary hover:underline"
              >
                Analyse your site ({projectDomain})
              </a>
            )}
          </div>
        ) : (
          <Suspense
            key={`${domain}|${country}|${range}`}
            fallback={<ExplorerLoading />}
          >
            <Report
              domain={domain}
              country={country}
              projectId={project?.id ?? null}
              projectDomain={projectDomain}
              userId={session?.userId ?? null}
              range={range}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
