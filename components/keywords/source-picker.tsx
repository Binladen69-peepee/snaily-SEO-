"use client";

import { Check, ChevronDown, Search, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import type { DeepDiveSource, SourceInfo } from "@/lib/keywords/suggest-sources";
import { cn } from "@/lib/utils";

/**
 * Where the ideas come from.
 *
 * Several sources can run at once — combining Google and Amazon is the point,
 * since one shows what people ask and the other what they buy. Sources with no
 * public endpoint are listed but disabled, with the reason on the row, so it is
 * clear they were considered rather than forgotten.
 */
export function SourcePicker({
  sources,
  selected,
  onChange,
}: {
  sources: SourceInfo[];
  selected: DeepDiveSource[];
  onChange: (next: DeepDiveSource[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();

    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return sources;
    return sources.filter(
      (s) => s.label.toLowerCase().includes(q) || s.note.toLowerCase().includes(q),
    );
  }, [sources, query]);

  const label =
    selected.length === 0
      ? "Pick a source"
      : selected.length === 1
        ? (sources.find((s) => s.id === selected[0])?.label ?? "Source")
        : `${String(selected.length)} sources`;

  function toggle(source: SourceInfo) {
    if (!source.available) return;
    const next = selected.includes(source.id)
      ? selected.filter((s) => s !== source.id)
      : [...selected, source.id];
    // Something always has to be selected, or Search has nothing to do.
    onChange(next.length === 0 ? selected : next);
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm sm:w-52"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Keyword sources"
          className="absolute z-50 mt-1 max-h-[22rem] w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                placeholder="Filter sources"
                className="h-8 pl-8 text-sm"
                autoComplete="off"
              />
            </div>
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {shown.map((source) => {
              const on = selected.includes(source.id);
              return (
                <li key={source.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={!source.available}
                    onClick={() => {
                      toggle(source);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left",
                      source.available
                        ? "hover:bg-accent"
                        : "cursor-not-allowed opacity-60",
                      on && "bg-accent/60",
                    )}
                  >
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                      {on && <Check className="size-3.5 text-primary" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{source.label}</span>
                        {source.costsQuota === true && (
                          <Zap
                            className="size-3 text-warning"
                            aria-label="Uses a SERP lookup"
                          />
                        )}
                        {!source.available && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            not connected
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {source.available ? source.note : source.reason}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                No source matches that.
              </li>
            )}
          </ul>

          <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            <Zap className="mr-1 inline size-3 text-warning" aria-hidden />
            spends one SERP lookup. The autocomplete sources are free and cached
            for a week.
          </p>
        </div>
      )}
    </div>
  );
}
