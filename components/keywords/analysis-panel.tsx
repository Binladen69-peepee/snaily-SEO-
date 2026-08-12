import { Search } from "lucide-react";
import Link from "next/link";

import { PrintButton } from "@/components/keywords/print-button";
import { SerpAnalysis } from "@/components/keywords/serp-analysis";
import { SuggestionColumns } from "@/components/keywords/suggestions";
import { TrendChart } from "@/components/keywords/trend-chart";
import { ExportCsvButton } from "@/components/keywords/export-csv-button";
import {
  difficultyBand,
  formatCpc,
  formatNumber,
} from "@/lib/keywords/format";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { ProviderError, type SearchParams } from "@/lib/keywords/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] leading-none text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-[15px] font-semibold leading-none">
        {value}
      </p>
    </div>
  );
}

/** Sentence-cased for the card title, the way KeySearch prints the keyword. */
function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Left-hand analysis of the searched keyword: headline metrics with the
 * difficulty bar, the 12-month trend, first-page competition, and autocomplete
 * ideas.
 *
 * Rendered in its own Suspense boundary so the keyword list on the right is
 * never blocked waiting for SERP data.
 */
export async function AnalysisPanel({ params }: { params: SearchParams }) {
  const provider = getKeywordProvider();

  let detail;
  let suggestions;
  try {
    [detail, suggestions] = await Promise.all([
      provider.detail(params.keyword, params.country, params.language),
      provider.suggest(params.keyword, params.country),
    ]);
  } catch (err) {
    return (
      <div
        role="alert"
        className="rounded border border-destructive/40 bg-destructive/5 p-4"
      >
        <p className="font-medium text-destructive">
          Could not analyse this keyword
        </p>
        <p className="text-sm text-muted-foreground">
          {err instanceof ProviderError
            ? err.message
            : "The keyword data source is unavailable. Please try again."}
        </p>
      </div>
    );
  }

  const band = difficultyBand(detail.difficulty);
  const location =
    params.country === "any" ? "ALL" : params.country.toUpperCase();

  return (
    <div className="space-y-3">
      {/* ---------- Headline ---------- */}
      <section className="rounded border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
          <h2 className="text-[15px] font-semibold">
            {sentenceCase(detail.keyword)}
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">
              Competition is {band.label.toLowerCase()}
            </span>
            <span
              className={`tabular inline-flex min-w-9 items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold text-white ${band.bar}`}
            >
              {detail.difficulty}
            </span>
          </div>
        </div>

        <div
          className="mx-4 mt-2.5 h-[5px] overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={detail.difficulty}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Keyword difficulty"
        >
          <div
            className={`h-full rounded-full ${band.bar}`}
            style={{ width: `${String(detail.difficulty)}%` }}
          />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 px-4 pb-3.5 pt-3">
          <div className="flex flex-wrap gap-x-7 gap-y-3">
            <Stat label="Volume" value={formatNumber(detail.volume)} />
            <Stat label="CPC" value={formatCpc(detail.cpc)} />
            <Stat label="PPC" value={detail.competition.toFixed(2)} />
            <Stat label="Location" value={location} />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 print:hidden">
            <ExportCsvButton
              keyword={detail}
              related={[...detail.related, ...detail.questions]}
              country={params.country}
            />
            <PrintButton />
            <Link
              href={`/keywords/${encodeURIComponent(detail.keyword)}?country=${params.country}`}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-[12.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Search className="size-3.5" aria-hidden />
              Deep Analysis
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- Trend ---------- */}
      <section className="rounded border border-border bg-card">
        <h3 className="border-b border-border px-4 py-2.5 text-[14px] font-semibold">
          Search Trends
          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
            Past 12 months
          </span>
        </h3>
        <div className="px-3 py-3">
          <TrendChart trend={detail.trend} />
        </div>
      </section>

      {/* ---------- SERP ---------- */}
      <SerpAnalysis results={detail.serp} />

      {/* ---------- Autocomplete ---------- */}
      <section className="rounded border border-border bg-card print:hidden">
        <h3 className="border-b border-border px-4 py-2.5 text-[14px] font-semibold">
          Search Engine Keyword Suggestions
        </h3>
        <div className="p-3">
          <SuggestionColumns
            suggestions={suggestions}
            country={params.country}
          />
        </div>
      </section>
    </div>
  );
}
