"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { COMPETITOR_TAB_ITEMS } from "@/components/competitors/competitor-sub-nav";
import { cn } from "@/lib/utils";

export type Tab = { href: string; label: string };

/**
 * Underlined tab row used inside a tool section, matching KeySearch's
 * sub-navigation. Scrolls horizontally rather than wrapping on narrow screens.
 */
export function SubTabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const pathname = usePathname();

  // Longest matching href wins, so "/competitors/organic" doesn't also light
  // up the "/competitors" tab.
  const activeHref = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  /*
   * The underline lives on the wrapper and the scroller is pulled down over it
   * by 1px. Putting that negative margin on the tabs instead made them stick
   * 1px past the scroller's content box, which counts as vertical overflow and
   * made the browser draw a stray vertical scrollbar beside the tab row.
   */
  return (
    <div className="border-b border-border">
      <nav
        aria-label={label}
        className="-mx-1 -mb-px flex gap-1 overflow-x-auto px-1"
      >
        {tabs.map((tab) => {
          const active = tab.href === activeHref;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary font-medium text-foreground"
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

/** Prefer CompetitorSubNav — keeps domain across Competitive Analysis tools. */
export const COMPETITOR_TABS: Tab[] = COMPETITOR_TAB_ITEMS.map(
  ({ href, label }) => ({ href, label }),
);
