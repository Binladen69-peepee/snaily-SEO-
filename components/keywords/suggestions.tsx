import Link from "next/link";

import { SUGGEST_SOURCES, type Suggestions } from "@/lib/keywords/types";

/**
 * Autocomplete phrases from the search engines, laid out as the two columns of
 * wide grey buttons KeySearch shows. Each links into a fresh search so a user
 * can walk from one idea to the next without retyping.
 */
export function SuggestionColumns({
  suggestions,
  country,
}: {
  suggestions: Suggestions;
  country: string;
}) {
  // The engines overlap heavily; one de-duplicated list reads better than four
  // near-identical columns, and matches how KeySearch presents them.
  const phrases = [
    ...new Set(SUGGEST_SOURCES.flatMap((source) => suggestions[source])),
  ].filter((p) => p.trim() !== "");

  if (phrases.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No autocomplete suggestions for this keyword.
      </p>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {phrases.map((phrase) => (
        <li key={phrase}>
          <Link
            href={`/keywords?q=${encodeURIComponent(phrase)}&country=${country}`}
            title={phrase}
            className="block truncate rounded bg-muted px-3 py-2.5 text-center text-[13px] transition-colors hover:bg-accent hover:text-primary"
          >
            {phrase}
          </Link>
        </li>
      ))}
    </ul>
  );
}
