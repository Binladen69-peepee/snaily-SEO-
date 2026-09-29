"use client";

import { FolderOpen, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { KeywordTypeahead } from "@/components/keywords/keyword-typeahead";
import { ToolbarActions } from "@/components/keywords/toolbar";
import {
  COUNTRIES,
  SEARCH_MODE_LABEL,
  SEARCH_MODES,
} from "@/lib/keywords/types";

const SELECT =
  "h-[38px] min-w-0 flex-1 border-t border-border bg-transparent pl-2.5 pr-6 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none sm:border-l sm:border-t-0 sm:pl-3 sm:pr-7";

/**
 * The full-width search strip: keyword typeahead with auto-suggest + history,
 * a location selector, a match-type selector, and the Search button.
 */
export function SearchBar({ activeFilterCount }: { activeFilterCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [keyword, setKeyword] = useState(params.get("q") ?? "");
  const [country, setCountry] = useState(params.get("country") ?? "us");
  const [mode, setMode] = useState(params.get("mode") ?? "related");

  const search = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (q === "") return;
      const next = new URLSearchParams({ q, country });
      if (mode !== "related") next.set("mode", mode);
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`);
      });
    },
    [country, mode, pathname, router, startTransition],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    search(keyword);
  }

  return (
    <div className="flex flex-col gap-x-3 gap-y-2 border-b border-border bg-card px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center">
      <form
        onSubmit={onSubmit}
        className="flex min-w-0 w-full flex-1 flex-wrap items-center rounded border border-border bg-background sm:w-auto"
      >
        <div className="relative flex w-full min-w-0 items-center sm:w-auto sm:flex-1">
          <span className="pointer-events-none shrink-0 pl-2.5 pr-1.5 text-muted-foreground">
            <FolderOpen className="size-4" aria-hidden />
          </span>
          <KeywordTypeahead
            className="min-w-0 flex-1"
            inputClassName="h-[38px] border-0 shadow-none rounded-none bg-transparent pl-1 pr-1 text-[13.5px] focus-visible:ring-0"
            value={keyword}
            country={country}
            placeholder="Enter a keyword"
            onChange={setKeyword}
            onSelect={search}
            hideIcon
          />
        </div>

        <select
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
          }}
          aria-label="Location"
          className={SELECT}
        >
          <option value="any">All Countries</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>

        <select
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
          }}
          aria-label="Match type"
          className={`${SELECT} border-l sm:border-l`}
        >
          {SEARCH_MODES.map((m) => (
            <option key={m} value={m}>
              {SEARCH_MODE_LABEL[m]}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending}
          className="m-[3px] inline-flex h-8 shrink-0 items-center gap-2 rounded bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-80 sm:px-5"
        >
          Search
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        </button>
      </form>

      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
        <ToolbarActions activeFilterCount={activeFilterCount} />
      </div>
    </div>
  );
}
