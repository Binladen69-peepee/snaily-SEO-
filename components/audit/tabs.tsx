"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/audit", label: "Latest Audit" },
  { href: "/audit/history", label: "History" },
];

export function AuditTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Audit views"
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === "/audit"
            ? pathname === "/audit"
            : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
  );
}
