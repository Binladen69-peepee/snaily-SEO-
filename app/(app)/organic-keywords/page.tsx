import { Search } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { CASearchBar } from "@/components/competitors/ca-search-bar";
import { ExplorerLoading } from "@/components/competitors/explorer-loading";
import { OrganicTable } from "@/components/competitors/organic-table";
import {
  PageHeader,
  SourceNote,
  StatTile,
  ToolPrompt,
} from "@/components/tool-shell";
import { Badge } from "@/components/ui/badge";
import { getOrganicKeywords, normalizeDomain } from "@/lib/competitors";
import { formatNumber, formatVolume } from "@/lib/keywords/format";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Organic Keywords · Snaily SEO" };

export const maxDuration = 60;

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(v: string | string[] | undefined, fallback: string): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() || fallback;
}

async function Organic({
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
  let result;
  try {
    result = await getOrganicKeywords(domain, country, projectId, projectDomain);
  } catch (err) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-4"
      >
        <p className="font-medium text-destructive">Could not read {domain}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {err instanceof Error ? err.message : "Please try again."}
        </p>
      </div>
    );
  }

  const measured = result.source === "search-console";
  const { keywords } = result;

  if (keywords.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="font-medium">No keywords found for {domain}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Nothing recurs across enough of the site&apos;s pages to call it a
          target. Very small sites often look like this.
        </p>
      </div>
    );
  }

  const totalClicks = keywords.reduce((s, k) => s + k.clicks, 0);
  const totalImpressions = keywords.reduce((s, k) => s + k.impressions, 0);
  const estTraffic = keywords.reduce((s, k) => s + (k.estTraffic ?? 0), 0);

  // Averages must only count keywords that actually have a position. Dividing
  // the summed position by the total keyword count treated every unranked row
  // as position 0 and dragged the average towards 1.
  const ranked = keywords.filter(
    (k): k is typeof k & { position: number } => k.position !== null,
  );
  const top3 = ranked.filter((k) => k.position <= 3).length;
  const top10 = ranked.filter((k) => k.position <= 10).length;
  const avgPosition =
    ranked.length === 0
      ? null
      : ranked.reduce((s, k) => s + k.position, 0) / ranked.length;

  // Measured rows have real clicks; derived rows only have modelled traffic.
  const trafficValue = measured
    ? keywords.reduce((s, k) => s + k.clicks * k.cpc, 0)
    : keywords.reduce((s, k) => s + (k.estTraffic ?? 0) * k.cpc, 0);

  const difficulties = keywords.map((k) => k.difficulty).sort((a, b) => a - b);
  const medianKd = difficulties[Math.floor((difficulties.length - 1) / 2)] ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Keywords" value={formatNumber(keywords.length)} />
        <StatTile
          label="With a position"
          value={formatNumber(ranked.length)}
          hint={measured ? "from Search Console" : "from cached results"}
        />
        <StatTile
          label="Est. traffic"
          value={formatNumber(estTraffic)}
          hint="visits / month"
        />
        <StatTile
          label="Traffic value"
          value={`$${Math.round(trafficValue).toLocaleString("en-US")}`}
          hint={measured ? "clicks × CPC" : "est. traffic × CPC"}
        />
        <StatTile label="In top 3" value={formatNumber(top3)} />
        <StatTile label="In top 10" value={formatNumber(top10)} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Average position"
          value={avgPosition === null ? "—" : avgPosition.toFixed(1)}
          hint={
            ranked.length === 0
              ? "nothing ranked yet"
              : `across ${formatNumber(ranked.length)} ranked`
          }
        />
        <StatTile label="Median KD" value={String(medianKd)} />
        <StatTile
          label="Est. volume"
          value={formatVolume(keywords.reduce((s, k) => s + k.volume, 0))}
          hint="combined"
        />
        {measured ? (
          <StatTile
            label="Average CTR"
            value={`${(
              (totalImpressions === 0 ? 0 : totalClicks / totalImpressions) * 100
            ).toFixed(1)}%`}
            hint={`${formatNumber(totalClicks)} clicks · 28 days`}
          />
        ) : (
          <StatTile
            label="Impressions"
            value={formatVolume(totalImpressions)}
            hint="Search Console only"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {measured ? "Ranked keywords" : "Targeted keywords"}
        </h2>
        <Badge variant={measured ? "success" : "secondary"}>
          {measured
            ? "Measured — Search Console"
            : "Derived from the site's own pages"}
        </Badge>
      </div>

      <OrganicTable
        keywords={keywords}
        measured={measured}
        country={country}
        domain={result.domain}
      />

      <SourceNote>
        {measured ? (
          <>
            Keyword, position, clicks, impressions and CTR are measured — they
            come from your Search Console property over the last 28 days.
            Volume, CPC and difficulty are estimated, because Search Console
            does not report them.
          </>
        ) : (
          <>
            These are the phrases {result.domain} <em>targets</em>, read from
            its own titles, H1s and meta descriptions. They are not measured
            rankings: no free source can report what an arbitrary domain ranks
            for. For your own site,{" "}
            <Link href="/projects" className="text-primary hover:underline">
              connect Search Console
            </Link>{" "}
            and this page switches to real positions and clicks.
          </>
        )}
      </SourceNote>
    </div>
  );
}

export default async function OrganicKeywordsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const country = first(raw.country, "us");
  const project = await getActiveProject();
  const projectDomain = project ? normalizeDomain(project.url) : null;

  // Default to your own site — the one domain we can report real rankings for.
  const domain = normalizeDomain(first(raw.domain, projectDomain ?? ""));

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <PageHeader
        title="Organic Keywords"
        description="The phrases a site ranks for, or is written to rank for."
      />

      <CASearchBar target="/organic-keywords" />

      {domain === "" ? (
        <ToolPrompt icon={Search} title="Enter a domain">
          Your own site returns real positions, clicks and impressions. A
          competitor returns the keywords their pages are written to win, with
          estimated volume and difficulty.
        </ToolPrompt>
      ) : (
        <Suspense
          key={`${domain}|${country}`}
          fallback={<ExplorerLoading />}
        >
          <Organic
            domain={domain}
            country={country}
            projectId={project?.id ?? null}
            projectDomain={projectDomain}
          />
        </Suspense>
      )}
    </div>
  );
}
