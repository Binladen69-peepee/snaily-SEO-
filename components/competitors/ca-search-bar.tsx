"use client";

import { Folder } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { EqualizerInline } from "@/components/ui/equalizer-loader";

/**
 * Shared Competitive Analysis search bar (Explorer style).
 * Submits into whichever CA tool is currently open so layout stays identical.
 */
export function CASearchBar({
  domain: domainProp,
  country: countryProp,
}: {
  /** Omit to read the current domain straight from the URL. */
  domain?: string;
  country?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /*
   * Reading the URL here rather than taking props lets this live in the
   * Competitive Analysis layout, which is what keeps it mounted while the
   * panel below swaps between tabs.
   */
  const urlDomain =
    params.get("domain") ??
    params.get("them") ??
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

  const domain = domainProp ?? urlDomain;
  const country = countryProp ?? params.get("country") ?? "us";
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(domain);
  const [scope, setScope] = useState<"domain" | "page">("domain");

  useEffect(() => {
    setValue(domain);
  }, [domain]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q === "") return;

    startTransition(() => {
      if (scope === "page") {
        const url = /^https?:\/\//i.test(q) ? q : `https://${q}`;
        router.push(
          `/competitors/url-metrics?url=${encodeURIComponent(url)}`,
        );
        return;
      }

      const params = new URLSearchParams({ domain: q, country });

      if (pathname.startsWith("/competitors/backlinks")) {
        router.push(`/competitors/backlinks?${params.toString()}`);
        return;
      }
      if (pathname.startsWith("/competitors/organic")) {
        router.push(`/competitors/organic?${params.toString()}`);
        return;
      }
      if (pathname.startsWith("/competitors/gap")) {
        router.push(
          `/competitors/gap?them=${encodeURIComponent(q)}&country=${country}`,
        );
        return;
      }
      if (pathname.startsWith("/competitors/url-metrics")) {
        router.push(
          `/competitors/url-metrics?url=${encodeURIComponent(`https://${q}`)}`,
        );
        return;
      }
      if (pathname.startsWith("/audit")) {
        router.push(`/competitors?${params.toString()}`);
        return;
      }

      router.push(`/competitors?${params.toString()}`);
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-b border-border bg-card px-3 py-3 sm:flex-row sm:items-center sm:px-4"
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
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      <select
        value={scope}
        onChange={(e) => {
          setScope(e.target.value as "domain" | "page");
        }}
        aria-label="Scope"
        className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <option value="domain">Entire Domain</option>
        <option value="page">Single Page</option>
      </select>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-80"
      >
        {pending ? <EqualizerInline /> : null}
        Search
      </button>
    </form>
  );
}
