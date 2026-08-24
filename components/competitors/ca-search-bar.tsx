"use client";

import { Folder } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useTransition } from "react";

import { EqualizerInline } from "@/components/ui/equalizer-loader";
import { cn } from "@/lib/utils";

/**
 * Where a domain search lands.
 *
 * Each Competitive Analysis tool is its own top-level page, so the page passes
 * its own route in rather than the bar guessing from the pathname.
 */
export type SearchTarget =
  | "/competitors"
  | "/backlinks"
  | "/organic-keywords"
  | "/url-metrics";

function destination(
  target: SearchTarget,
  query: string,
  country: string,
): string {
  if (target === "/url-metrics") {
    const url = /^https?:\/\//i.test(query) ? query : `https://${query}`;
    return `/url-metrics?url=${encodeURIComponent(url)}`;
  }
  const params = new URLSearchParams({ domain: query, country });
  return `${target}?${params.toString()}`;
}

function Bar({
  target,
  variant,
}: {
  target: SearchTarget;
  variant: "bar" | "card";
}) {
  const router = useRouter();
  const params = useSearchParams();

  /*
   * Seeded from the URL so a shared link opens with the domain already in the
   * box, and so following a link from another tool keeps the domain visible.
   */
  const urlDomain =
    params.get("domain") ??
    (() => {
      const raw = params.get("url");
      if (raw === null) return null;
      try {
        return new URL(raw).hostname.replace(/^www\./, "");
      } catch {
        return null;
      }
    })() ??
    "";

  const country = params.get("country") ?? "us";
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(urlDomain);
  const [scope, setScope] = useState<"domain" | "page">(
    target === "/url-metrics" ? "page" : "domain",
  );

  useEffect(() => {
    setValue(urlDomain);
  }, [urlDomain]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q === "") return;

    // "Single Page" is the one cross-tool jump left: it always means URL
    // Metrics, whichever tool you happened to be looking at.
    const where = scope === "page" ? "/url-metrics" : target;

    startTransition(() => {
      router.push(destination(where, q, country));
    });
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex flex-col gap-2 bg-card sm:flex-row sm:items-center",
        // "bar" runs edge to edge under the nav, the way the reference does;
        // "card" is the boxed form the other tools use inside their padding.
        variant === "bar"
          ? "border-b border-border px-3 py-2.5 sm:px-4"
          : "rounded-xl border border-border p-3 shadow-sm sm:p-4",
      )}
    >
      <div className="relative min-w-0 flex-1">
        <Folder
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          placeholder="Enter a domain, e.g. competitor.com"
          aria-label="Domain"
          className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      <select
        value={scope}
        onChange={(e) => {
          setScope(e.target.value as "domain" | "page");
        }}
        aria-label="Scope"
        className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <option value="domain">Entire Domain</option>
        <option value="page">Single Page</option>
      </select>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-80"
      >
        {pending ? <EqualizerInline /> : null}
        Search
      </button>
    </form>
  );
}

/**
 * Domain search bar shared by the Competitive Analysis tools.
 *
 * It reads the query string, so it carries its own Suspense boundary — without
 * one, every page that renders it would opt out of static prerendering.
 */
export function CASearchBar({
  target,
  variant = "card",
}: {
  target: SearchTarget;
  variant?: "bar" | "card";
}) {
  return (
    <Suspense
      fallback={
        <div
          className={cn(
            "bg-card",
            variant === "bar"
              ? "h-15 border-b border-border"
              : "h-19 rounded-xl border border-border shadow-sm sm:h-21",
          )}
          aria-hidden
        />
      }
    >
      <Bar target={target} variant={variant} />
    </Suspense>
  );
}
