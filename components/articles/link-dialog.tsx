"use client";

import { FileText, Loader2, Search, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Suggestion = {
  title: string;
  url: string;
  slug: string;
  type: string;
  kind: "internal" | "affiliate";
  rel?: string;
  target?: string;
};

export type AppliedLink = { href: string; rel?: string; target?: string };

/**
 * Link picker.
 *
 * Two sources, kept visibly apart because they behave differently: the site's
 * own posts, which are ordinary dofollow links, and the author's ingredient
 * sheet, whose links are affiliate URLs and go out marked `sponsored nofollow`.
 * Both are real records — nothing is suggested that the app has not seen on the
 * live site or in the sheet. Typing a URL by hand is still allowed, but that is
 * the author's own claim rather than ours.
 *
 * Suggestions appear as you type, seeded from whatever text is selected, so the
 * common case is: select "smoked paprika", press the link button, press Enter.
 */
export function LinkDialog({
  articleId,
  initialHref,
  selectedText,
  onApply,
  onRemove,
  onClose,
}: {
  /** Absent when the editor is used outside an article — search is hidden. */
  articleId?: string;
  initialHref: string;
  /** Text the link will wrap, used to seed the search. */
  selectedText: string;
  onApply: (link: AppliedLink) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [href, setHref] = useState(initialHref);
  const [query, setQuery] = useState(selectedText.trim());
  const [results, setResults] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<{ pages: number; products: number } | null>(
    null,
  );
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Debounced so typing a title does not fire a request per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q === "" || articleId === undefined) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/articles/${articleId}/links?q=${encodeURIComponent(q)}`,
          );
          const data = (await res.json()) as {
            suggestions?: Suggestion[];
            total?: number;
            products?: number;
          };
          setResults(data.suggestions ?? []);
          setActive(0);
          setCounts({ pages: data.total ?? 0, products: data.products ?? 0 });
        } catch {
          setResults([]);
        } finally {
          setLoading(false);
        }
      })();
    }, 200);
    return () => {
      clearTimeout(timer);
    };
  }, [query, articleId]);

  const groups = useMemo(
    () => ({
      pages: results.filter((r) => r.kind === "internal"),
      products: results.filter((r) => r.kind === "affiliate"),
    }),
    [results],
  );

  /** Flat order for keyboard navigation, matching what is rendered. */
  const ordered = useMemo(
    () => [...groups.pages, ...groups.products],
    [groups],
  );

  function choose(s: Suggestion) {
    onApply({ href: s.url, rel: s.rel, target: s.target });
  }

  /** Arrow keys move through results; Enter takes the highlighted one. */
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (ordered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % ordered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + ordered.length) % ordered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = ordered[active];
      if (pick) choose(pick);
    }
  }

  function Row({ s, index }: { s: Suggestion; index: number }) {
    const Icon = s.kind === "affiliate" ? ShoppingBag : FileText;
    return (
      <li>
        <button
          type="button"
          onMouseEnter={() => {
            setActive(index);
          }}
          onClick={() => {
            choose(s);
          }}
          className={`flex w-full items-start gap-2 px-3 py-2 text-left ${
            index === active ? "bg-accent" : "hover:bg-accent/60"
          }`}
        >
          <Icon
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{s.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {s.url}
            </span>
          </span>
          {s.rel !== undefined && (
            <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              sponsored
            </span>
          )}
        </button>
      </li>
    );
  }

  const nothingFound =
    articleId !== undefined && query.trim() !== "" && !loading && results.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16 sm:pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Insert link"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-6rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Insert link</h2>
          {selectedText.trim() !== "" && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Linking &ldquo;{selectedText.trim()}&rdquo;
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {articleId !== undefined && (
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor="link-search"
              >
                Search your posts and ingredient links
                {counts !== null &&
                  ` (${String(counts.pages)} pages, ${String(counts.products)} products)`}
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  ref={inputRef}
                  id="link-search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                  onKeyDown={onSearchKey}
                  placeholder="ginger cake, smoked paprika…"
                  className="pl-8"
                  autoComplete="off"
                />
                {loading && (
                  <Loader2
                    className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                )}
              </div>
            </div>
          )}

          {groups.pages.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Your posts
              </p>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {groups.pages.map((s, i) => (
                  <Row key={`p-${s.url}`} s={s} index={i} />
                ))}
              </ul>
            </div>
          )}

          {groups.products.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Ingredient &amp; product links
              </p>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {groups.products.map((s, i) => (
                  <Row
                    key={`a-${s.title}`}
                    s={s}
                    index={groups.pages.length + i}
                  />
                ))}
              </ul>
            </div>
          )}

          {nothingFound && (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Nothing in your posts or your ingredient sheet matches that. Only
              links the app can verify are suggested — paste a URL below if you
              know it.
            </p>
          )}

          <div>
            <label
              className="mb-1 block text-xs font-medium text-muted-foreground"
              htmlFor="link-url"
            >
              Or paste a URL
            </label>
            <Input
              id="link-url"
              value={href}
              onChange={(e) => {
                setHref(e.target.value);
              }}
              placeholder="https://… or /a-post-slug/"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && href.trim() !== "") {
                  e.preventDefault();
                  onApply({ href: href.trim() });
                }
              }}
            />
          </div>
        </div>

        <div className="flex justify-between gap-2 border-t border-border px-4 py-3">
          {initialHref !== "" ? (
            <Button variant="outline" size="sm" onClick={onRemove}>
              Remove link
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={href.trim() === ""}
              onClick={() => {
                onApply({ href: href.trim() });
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
