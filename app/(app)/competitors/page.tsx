import { Target } from "lucide-react";
import { Suspense } from "react";

import {
  ExplorerDashboard,
  ExplorerLoading,
} from "@/components/competitors/explorer-dashboard";
import {
  buildExplorerReport,
  normalizeDomain,
} from "@/lib/competitors";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Competitive Analysis · Snaily SEO" };

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
}: {
  domain: string;
  country: string;
  projectId: string | null;
  projectDomain: string | null;
}) {
  try {
    const report = await buildExplorerReport(
      domain,
      country,
      projectId,
      projectDomain,
    );
    return <ExplorerDashboard report={report} />;
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
  const project = await getActiveProject();
  const domain = normalizeDomain(first(raw.domain, ""));
  const projectDomain = project ? normalizeDomain(project.url) : null;

  return (
    <>
      {domain === "" ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <Target className="size-10 text-primary/50" aria-hidden />
          <p className="mt-3 text-base font-semibold">
            Enter a domain to explore it
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Search any domain for organic keywords, estimated domain strength,
            backlink signals and competitors found in SERPs.
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
        <Suspense key={`${domain}|${country}`} fallback={<ExplorerLoading />}>
          <Report
            domain={domain}
            country={country}
            projectId={project?.id ?? null}
            projectDomain={projectDomain}
          />
        </Suspense>
      )}
    </>
  );
}
