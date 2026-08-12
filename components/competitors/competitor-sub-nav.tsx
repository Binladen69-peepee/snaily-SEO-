"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CompetitorTab = {
  href: string;
  label: string;
  /** How to attach the current domain when switching tabs. */
  param?: "domain" | "them" | "url" | "none";
};

export const COMPETITOR_TAB_ITEMS: CompetitorTab[] = [
  { href: "/competitors", label: "Explorer", param: "domain" },
  { href: "/competitors/backlinks", label: "Backlink Checker", param: "domain" },
  { href: "/competitors/organic", label: "Organic Keywords", param: "domain" },
  { href: "/audit", label: "Site Audit", param: "none" },
  { href: "/competitors/gap", label: "Competitor Gap", param: "them" },
  { href: "/competitors/url-metrics", label: "URL Metrics", param: "url" },
];

function tabHref(tab: CompetitorTab, domain: string): string {
  if (domain === "" || tab.param === "none" || tab.param === undefined) {
    return tab.href;
  }
  if (tab.param === "them") {
    return `${tab.href}?them=${encodeURIComponent(domain)}`;
  }
  if (tab.param === "url") {
    return `${tab.href}?url=${encodeURIComponent(`https://${domain}`)}`;
  }
  return `${tab.href}?domain=${encodeURIComponent(domain)}`;
}

/**
 * Competitive Analysis section tabs.
 *
 * Carries the analysed domain across Explorer → Backlinks → Organic → Gap →
 * URL Metrics so each option opens with that domain already loaded.
 */
export function CompetitorSubNav({
  domain = "",
}: {
  /** Explicit domain when the page already knows it (preferred). */
  domain?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const fromQuery =
    params.get("domain") ??
    params.get("them") ??
    (() => {
      const url = params.get("url");
      if (!url) return "";
      try {
        return new URL(url.startsWith("http") ? url : `https://${url}`)
          .hostname.replace(/^www\./, "")
          .toLowerCase();
      } catch {
        return "";
      }
    })();

  const activeDomain = (domain || fromQuery).trim().toLowerCase();

  const activeHref = COMPETITOR_TAB_ITEMS.filter(
    (t) => pathname === t.href || pathname.startsWith(`${t.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="border-b border-border">
      <nav
        aria-label="Competitive analysis"
        className="-mb-px flex gap-0.5 overflow-x-auto"
      >
        {COMPETITOR_TAB_ITEMS.map((tab) => {
          const active = tab.href === activeHref;
          return (
            <Link
              key={tab.href}
              href={tabHref(tab, activeDomain)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                active
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Shared outline / solid action buttons used on Explorer cards. */
export function CardAction({
  href,
  children,
  variant = "outline",
  onClick,
}: {
  href?: string;
  children: ReactNode;
  variant?: "outline" | "solid";
  onClick?: () => void;
}) {
  const className = cn(
    "inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3.5 text-xs font-semibold transition-colors",
    variant === "solid"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border border-primary bg-card text-primary hover:bg-primary/5",
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}
