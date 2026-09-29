"use client";

/**
 * Live keyword suggestions as you type.
 *
 * The backend has answered `/api/keywords/suggest` for a long time; nothing
 * called it until the user had already pressed search, which is the one moment
 * a suggestion is no longer useful.
 *
 * Four things make this cheap enough to run on every keystroke without
 * actually running on every keystroke: a debounce, a minimum length, an
 * in-memory cache of queries already asked, and an AbortController so a reply
 * to "vegan mus" cannot arrive after "vegan mushroom" and overwrite it. That
 * last one is the bug this pattern usually ships with.
 *
 * The input is never blocked. Suggestions are an offer; typing and pressing
 * Enter always works whether or not any arrived.
 */

import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Long enough to be a real prefix; shorter queries return noise. */
const MIN_CHARS = 3;
/** Slower than a keystroke, faster than a thought. */
const DEBOUNCE_MS = 280;
const MAX_SHOWN = 8;

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; items: string[] }
  | { kind: "error" };

/** Highlight the part the user actually typed. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0 || query === "") return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-foreground">
        {text.slice(at, at + query.length)}
      </span>
      {text.slice(at + query.length)}
    </>
  );
}

export function KeywordTypeahead({
  value,
  onChange,
  onSelect,
  country = "us",
  placeholder = "Enter a keyword",
  className,
  inputClassName,
  autoFocus,
  /** Hide the built-in search icon (when the parent already provides one). */
  hideIcon,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Chosen from the list, or Enter on the typed text. */
  onSelect: (keyword: string) => void;
  country?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  hideIcon?: boolean;
}) {
  const listId = useId();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  /** Queries already answered this session. Cheap and bounded. */
  const cache = useRef(new Map<string, string[]>());
  const inflight = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(
    async (query: string) => {
      const key = `${country}:${query.toLowerCase()}`;

      const cached = cache.current.get(key);
      if (cached !== undefined) {
        setState({ kind: "ready", items: cached });
        return;
      }

      // Whatever was in flight is answering a prefix nobody is typing now.
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;

      setState({ kind: "loading" });
      try {
        const res = await fetch(
          `/api/keywords/suggest?q=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          setState({ kind: "error" });
          return;
        }
        const data = (await res.json()) as {
          suggestions?: Record<string, string[]>;
        };
        const items = [
          ...new Set(Object.values(data.suggestions ?? {}).flat()),
        ]
          .map((s) => s.trim())
          .filter((s) => s !== "" && s.toLowerCase() !== query.toLowerCase())
          .slice(0, MAX_SHOWN);

        cache.current.set(key, items);
        if (cache.current.size > 100) {
          // Keep the map from growing without bound over a long session.
          const oldest = cache.current.keys().next().value;
          if (oldest !== undefined) cache.current.delete(oldest);
        }
        setState({ kind: "ready", items });
      } catch (err) {
        // An abort is this component doing its job, not a failure.
        if (err instanceof Error && err.name === "AbortError") return;
        setState({ kind: "error" });
      }
    },
    [country],
  );

  useEffect(() => {
    const query = value.trim();
    if (timer.current !== null) clearTimeout(timer.current);

    if (query.length < MIN_CHARS) {
      inflight.current?.abort();
      setState({ kind: "idle" });
      return;
    }

    timer.current = setTimeout(() => {
      void fetchSuggestions(query);
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [value, fetchSuggestions]);

  // Abort anything outstanding when the component goes away.
  useEffect(() => () => inflight.current?.abort(), []);

  const items = state.kind === "ready" ? state.items : [];
  const showPanel =
    open &&
    value.trim().length >= MIN_CHARS &&
    (state.kind === "loading" || state.kind === "error" || items.length > 0);

  function choose(keyword: string) {
    onChange(keyword);
    onSelect(keyword);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = active >= 0 ? items[active] : undefined;
      choose(picked ?? value.trim());
      return;
    }
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    }
  }

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        {!hideIcon && (
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        )}
        <input
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 ? `${listId}-opt-${String(active)}` : undefined
          }
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            // Let a click on an option land before the panel closes.
            window.setTimeout(() => {
              setOpen(false);
            }, 120);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "h-10 w-full rounded-md border border-input bg-background pr-9 text-sm",
            hideIcon ? "pl-3" : "pl-9",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            inputClassName,
          )}
        />
        {state.kind === "loading" && (
          <Loader2
            className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
      </div>

      {showPanel && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg",
          )}
        >
          {state.kind === "error" ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              Suggestions are unavailable right now. Your search still works.
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              {state.kind === "loading" ? "Looking…" : "No suggestions."}
            </p>
          ) : (
            <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
              {items.map((item, i) => (
                <li key={item}>
                  <button
                    type="button"
                    id={`${listId}-opt-${String(i)}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => {
                      setActive(i);
                    }}
                    onMouseDown={(e) => {
                      // Fire before blur so the choice is not lost.
                      e.preventDefault();
                      choose(item);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground",
                      i === active && "bg-accent text-foreground",
                    )}
                  >
                    <Search className="size-3 shrink-0 opacity-50" aria-hidden />
                    <span className="truncate">
                      <Highlighted text={item} query={value.trim()} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

    </div>
  );
}
