import { Gauge } from "lucide-react";
import { Suspense } from "react";

import { ScoreCircle } from "@/components/difficulty";
import { SearchForm } from "@/components/keywords/search-form";
import { SearchHistoryList } from "@/components/keywords/search-history";
import { SerpAnalysis } from "@/components/keywords/serp-analysis";
import { PageHeader, StatTile, ToolPrompt } from "@/components/tool-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCpc, formatNumber, formatVolume } from "@/lib/keywords/format";
import { getHistory } from "@/lib/keywords/history";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { ProviderError } from "@/lib/keywords/types";

export const metadata = { title: "Quick Difficulty · Snaily SEO" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function Result({ q, country }: { q: string; country: string }) {
  let detail;
  try {
    detail = await getKeywordProvider().detail(q, country, "en");
  } catch (err) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
      >
        {err instanceof ProviderError
          ? err.message
          : "Could not check this keyword."}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center justify-center rounded-xl border border-border bg-card p-6 lg:w-64">
          <ScoreCircle score={detail.difficulty} />
        </div>

        <div className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 className="truncate text-lg font-semibold">{detail.keyword}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Volume" value={formatVolume(detail.volume)} />
            <StatTile label="CPC" value={formatCpc(detail.cpc)} />
            <StatTile label="PPC" value={detail.competition.toFixed(2)} />
            <StatTile label="Results" value={formatNumber(detail.results)} />
          </div>
        </div>
      </div>

      <SerpAnalysis results={detail.serp} />
    </div>
  );
}

export default async function DifficultyPage({ searchParams }: Props) {
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q.trim() : "";
  const country = typeof raw.country === "string" ? raw.country : "us";
  const history = q === "" ? await getHistory() : [];

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <PageHeader
        title="Quick Difficulty"
        description="One keyword, straight to the difficulty score and the first page behind it."
      />

      <SearchForm showMode={false} placeholder="Enter a keyword to score it" />

      {q === "" ? (
        <>
          <ToolPrompt icon={Gauge} title="Enter a keyword to check difficulty">
            You&apos;ll get the difficulty score, headline metrics and the ten
            pages currently ranking, with the link strength behind each one.
          </ToolPrompt>
          {history.length > 0 && (
            <div className="mx-auto max-w-lg">
              <SearchHistoryList items={history} />
            </div>
          )}
        </>
      ) : (
        <Suspense
          key={`${q}|${country}`}
          fallback={<Skeleton className="h-80" />}
        >
          <Result q={q} country={country} />
        </Suspense>
      )}
    </div>
  );
}
