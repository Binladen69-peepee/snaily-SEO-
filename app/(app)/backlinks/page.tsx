import { Link2 } from "lucide-react";
import { Suspense } from "react";

import { CASearchBar } from "@/components/competitors/ca-search-bar";
import { ExplorerLoading } from "@/components/competitors/explorer-loading";
import {
  PageHeader,
  SourceNote,
  StatTile,
  ToolPrompt,
} from "@/components/tool-shell";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/keywords/format";
import { findMentions, normalizeDomain } from "@/lib/competitors";


export const metadata = { title: "Backlink Checker · Snaily SEO" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(v: string | string[] | undefined, fallback: string): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() || fallback;
}

async function Backlinks({ domain }: { domain: string }) {
  let report;
  try {
    report = await findMentions(domain);
  } catch (err) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
      >
        <p className="font-medium text-destructive">Could not check {domain}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {err instanceof Error ? err.message : "Please try again."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Citing pages"
          value={String(report.mentions.length)}
          hint="measured, live"
          className="shadow-sm"
        />
        <StatTile
          label="Citing domains"
          value={String(report.referringDomains)}
          hint="measured, live"
          className="shadow-sm"
        />
        <StatTile
          label="Snaily Domain Authority"
          value={
            report.authority.domainAuthority === null
              ? "N/A"
              : String(report.authority.domainAuthority)
          }
          hint="derived from free link-graph and SERP signals"
          className="shadow-sm"
        />
        <StatTile
          label="Backlinks"
          value={
            report.backlinks === null ? "N/A" : formatNumber(report.backlinks)
          }
          hint="derived from Common Crawl PageRank"
          className="shadow-sm"
        />
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-bold">Pages citing {domain}</h2>
            <p className="text-[11px] text-muted-foreground">
              Live results for pages that reference this domain
            </p>
          </div>
          <Badge variant="success">Measured</Badge>
        </div>

        {report.mentions.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {report.liveUnavailable
              ? "Live citation lookup needs SERPAPI_KEY. Only the estimates above are available."
              : `Google returned no pages citing ${domain}.`}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {report.mentions.map((m) => (
              <li key={m.url} className="px-4 py-3">
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {m.title}
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {m.domain}
                </p>
                {m.snippet !== "" && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {m.snippet}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <SourceNote>
        The citing pages above are real and live. They are{" "}
        <strong>citations, not confirmed backlinks</strong> — Google&apos;s
        <code className="mx-1 rounded bg-muted px-1">-site:</code> operator finds
        pages that mention a domain, whether or not they link to it. Snaily
        Domain Authority is <strong>derived</strong> from OpenPageRank, SERP
        presence and domain age. Backlink and referring-domain counts are
        reconstructed from the same Common Crawl PageRank graph — a sample of
        the web, not a live Ahrefs-style crawl.
      </SourceNote>
    </div>
  );
}

export default async function BacklinksPage({ searchParams }: Props) {
  const raw = await searchParams;
  const domain = normalizeDomain(first(raw.domain, ""));

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <PageHeader
        title="Backlink Checker"
        description="Who cites a domain, and how much link strength sits behind it."
      />

      <CASearchBar target="/backlinks" />

      {domain === "" ? (
        <ToolPrompt icon={Link2} title="Enter a domain to check">
          You&apos;ll get the pages Google knows that cite this domain —
          useful for outreach — alongside estimated authority figures, each
          clearly labelled as measured or estimated.
        </ToolPrompt>
      ) : (
        <Suspense key={domain} fallback={<ExplorerLoading />}>
          <Backlinks domain={domain} />
        </Suspense>
      )}
    </div>
  );
}
