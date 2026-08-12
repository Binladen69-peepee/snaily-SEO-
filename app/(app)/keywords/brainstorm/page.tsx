import { Sparkles } from "lucide-react";
import { Suspense } from "react";

import { SearchForm } from "@/components/keywords/search-form";
import { SuggestionColumns } from "@/components/keywords/suggestions";
import { KeywordTabs } from "@/components/keywords/tabs";
import { PageHeader, ToolPrompt } from "@/components/tool-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { ProviderError } from "@/lib/keywords/types";

export const metadata = { title: "Brainstorm · Snaily SEO" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function Columns({ q, country }: { q: string; country: string }) {
  try {
    const suggestions = await getKeywordProvider().suggest(q, country);
    return <SuggestionColumns suggestions={suggestions} country={country} />;
  } catch (err) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
      >
        {err instanceof ProviderError
          ? err.message
          : "Could not load suggestions."}
      </p>
    );
  }
}

export default async function BrainstormPage({ searchParams }: Props) {
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q.trim() : "";
  const country = typeof raw.country === "string" ? raw.country : "us";

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <PageHeader
        title="Brainstorm"
        description="Suggestions pulled from the search engines themselves — what people are actually typing."
      />

      <KeywordTabs />

      <SearchForm showMode={false} placeholder="Enter a seed keyword to expand" />

      {q === "" ? (
        <ToolPrompt icon={Sparkles} title="Enter a keyword to brainstorm">
          You&apos;ll get autocomplete phrases straight from the search engines
          — real queries people are typing.
        </ToolPrompt>
      ) : (
        <Suspense
          key={`${q}|${country}`}
          fallback={<Skeleton className="h-64" />}
        >
          <Columns q={q} country={country} />
        </Suspense>
      )}
    </div>
  );
}
