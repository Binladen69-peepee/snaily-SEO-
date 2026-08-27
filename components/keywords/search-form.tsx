"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { KeywordTypeahead } from "@/components/keywords/keyword-typeahead";
import {
  COUNTRIES,
  SEARCH_MODE_LABEL,
  SEARCH_MODES,
} from "@/lib/keywords/types";

const SELECT_CLASS =
  "h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SearchForm({
  /** Match-type selector only means something on the research page. */
  showMode = true,
  placeholder = "Enter a keyword, e.g. project management software",
}: {
  showMode?: boolean;
  placeholder?: string;
} = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const [keyword, setKeyword] = useState(params.get("q") ?? "");
  const [country, setCountry] = useState(params.get("country") ?? "us");
  const [mode, setMode] = useState(params.get("mode") ?? "related");

  /** One path for both a typed Enter and a chosen suggestion. */
  function search(raw: string) {
    const q = raw.trim();
    if (q === "") return;

    // A new search resets filters and pagination. Stays on the current tool —
    // searching from Brainstorm should brainstorm, not jump to Research.
    const next = new URLSearchParams({ q, country });
    if (showMode && mode !== "related") next.set("mode", mode);
    router.push(`${pathname}?${next.toString()}`);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    search(keyword);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
      {/*
        The typeahead owns its own input and search icon. Enter searches what
        is typed; arrow keys walk the suggestions and Enter takes the
        highlighted one — both land in the same search().
      */}
      <KeywordTypeahead
        className="flex-1"
        value={keyword}
        country={country}
        placeholder={placeholder}
        onChange={setKeyword}
        onSelect={search}
      />

      <select
        value={country}
        onChange={(e) => {
          setCountry(e.target.value);
        }}
        aria-label="Location"
        className={SELECT_CLASS}
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>

      {showMode && (
        <select
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
          }}
          aria-label="Match type"
          className={SELECT_CLASS}
        >
          {SEARCH_MODES.map((m) => (
            <option key={m} value={m}>
              {SEARCH_MODE_LABEL[m]}
            </option>
          ))}
        </select>
      )}

      <Button type="submit" size="lg" className="h-10">
        <Search />
        Search
      </Button>
    </form>
  );
}
