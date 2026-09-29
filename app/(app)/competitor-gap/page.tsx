import { Target } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ExplorerLoading } from "@/components/competitors/explorer-loading";
import { ScorePill } from "@/components/difficulty";
import {
  PageHeader,
  SourceNote,
  StatTile,
  ToolPrompt,
} from "@/components/tool-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { compareDomains, normalizeDomain, type GapRow } from "@/lib/competitors";
import { formatCpc, formatVolume } from "@/lib/keywords/format";
import { COUNTRIES } from "@/lib/keywords/types";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Competitor Gap · Snaily SEO" };

export const maxDuration = 60;

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(v: string | string[] | undefined, fallback: string): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() || fallback;
}

function GapTable({
  rows,
  country,
  emptyMessage,
}: {
  rows: GapRow[];
  country: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[38rem] text-sm">
        <caption className="sr-only">Keyword comparison</caption>
        <thead className="bg-muted/60">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-medium">
              Keyword
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Volume
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              CPC
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              KD
            </th>
            <th scope="col" className="px-2 py-2 text-left font-medium">
              Them
            </th>
            <th scope="col" className="px-2 py-2 text-left font-medium">
              You
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Research
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r) => (
            <tr key={r.keyword} className="border-t border-border hover:bg-accent/40">
              <td className="max-w-[20rem] truncate px-4 py-2" title={r.keyword}>
                {r.keyword}
              </td>
              <td className="tabular px-2 py-2 text-right">
                {formatVolume(r.volume)}
              </td>
              <td className="tabular px-2 py-2 text-right">{formatCpc(r.cpc)}</td>
              <td className="px-2 py-2 text-right">
                <ScorePill score={r.difficulty} />
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                {r.theirs}
              </td>
              <td className="whitespace-nowrap px-2 py-2">
                {r.yours ?? (
                  <span className="text-destructive">not covered</span>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                <Link
                  href={`/keywords?q=${encodeURIComponent(r.keyword)}&country=${country}`}
                  className="text-primary hover:underline"
                >
                  Analyse
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Gap({
  you,
  them,
  country,
  projectId,
  projectDomain,
}: {
  you: string;
  them: string;
  country: string;
  projectId: string | null;
  projectDomain: string | null;
}) {
  let result;
  try {
    result = await compareDomains(you, them, country, projectId, projectDomain);
  } catch (err) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-4"
      >
        <p className="font-medium text-destructive">Could not compare</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {err instanceof Error
            ? err.message
            : "One of the sites could not be reached."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Gaps"
          value={String(result.gaps.length)}
          hint="they cover, you don't"
        />
        <StatTile label="Shared" value={String(result.shared.length)} />
        <StatTile
          label="Your edge"
          value={String(result.yourEdge.length)}
          hint="you cover, they don't"
        />
        <StatTile
          label="Gap volume"
          value={formatVolume(
            result.gaps.reduce((s, r) => s + r.volume, 0),
          )}
          hint="estimated, combined"
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">
            Keywords {result.them.domain} covers and {result.you.domain} does not
          </h2>
          <p className="text-sm text-muted-foreground">
            Sorted by estimated volume — the biggest opportunities first.
          </p>
        </div>
        <GapTable
          rows={result.gaps}
          country={country}
          emptyMessage="No gaps found — you cover everything they target."
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">Covered by both</h2>
          <p className="text-sm text-muted-foreground">
            Where you compete head to head.
          </p>
        </div>
        <GapTable
          rows={result.shared}
          country={country}
          emptyMessage="Nothing in common — you are targeting entirely different topics."
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">Your edge</h2>
          <p className="text-sm text-muted-foreground">
            Topics you own that they have not touched.
          </p>
        </div>
        <GapTable
          rows={result.yourEdge}
          country={country}
          emptyMessage="They cover everything you do."
        />
      </section>

      <SourceNote>
        {result.you.source === "search-console"
          ? "Your side is measured from Search Console. "
          : "Both sides are read from each site's own titles, H1s and meta descriptions — what they are written to rank for. "}
        {result.them.source === "crawl" &&
          "The competitor side is read from their pages; no free source reports what another domain actually ranks for. "}
        Volume, CPC and difficulty are estimated throughout.
      </SourceNote>
    </div>
  );
}

export default async function CompetitorGapPage({ searchParams }: Props) {
  const raw = await searchParams;
  const country = first(raw.country, "us");
  const project = await getActiveProject();
  const projectDomain = project ? normalizeDomain(project.url) : null;

  const you = normalizeDomain(first(raw.you, projectDomain ?? ""));
  const them = normalizeDomain(first(raw.them, ""));

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <PageHeader
        title="Competitor Gap"
        description="What one site covers that the other does not."
      />

      <div className="space-y-3">
        <form
          method="get"
          className="rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4"
        >
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input
              name="you"
              defaultValue={you}
              placeholder="Your domain"
              aria-label="Your domain"
              autoComplete="off"
              className="h-10"
            />
            <Input
              name="them"
              defaultValue={them}
              placeholder="Competitor domain"
              aria-label="Competitor domain"
              autoComplete="off"
              className="h-10"
            />
            <div className="flex gap-2">
              <select
                name="country"
                defaultValue={country}
                aria-label="Country"
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-40 lg:flex-none"
              >
                <option value="any">All Countries</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Button type="submit" className="h-10 shrink-0 px-6">
                Compare
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Both sites are crawled, up to 24 pages each. Your own domain uses
            Search Console data instead, when it is connected.
          </p>
        </form>

        {you === "" || them === "" ? (
          <ToolPrompt icon={Target} title="Enter two domains to compare">
            Fill in your own domain and a competitor&apos;s. You&apos;ll get
            three lists: the gaps to close, the keywords you both fight over,
            and the ground you already hold alone.
          </ToolPrompt>
        ) : (
          <Suspense
            key={`${you}|${them}|${country}`}
            fallback={<ExplorerLoading />}
          >
            <Gap
              you={you}
              them={them}
              country={country}
              projectId={project?.id ?? null}
              projectDomain={projectDomain}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
