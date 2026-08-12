"use client";

import { ChevronDown, Menu, Snail, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ACCOUNT_NAV, FLAT_NAV, NAV, OWNER_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Primary navigation, laid out like KeySearch: one dark horizontal bar with
 * hover-opening dropdown sections, rather than a sidebar.
 */
export function TopNav({
  isOwner,
  children,
}: {
  isOwner: boolean;
  /** Account controls rendered on the right of the bar. */
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // Close menus on navigation and on outside click / Escape.
  useEffect(() => {
    setOpen(null);
    setDrawer(false);
  }, [pathname]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        setDrawer(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-nav text-nav-foreground">
      <div
        ref={barRef}
        className="flex h-[54px] items-center gap-0.5 px-3 sm:px-4"
        onMouseLeave={() => {
          setOpen(null);
        }}
      >
        <Link
          href="/keywords"
          className="mr-4 flex shrink-0 items-center gap-1.5 rounded font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Snail className="size-5 text-primary" aria-hidden />
          <span className="hidden text-[17px] tracking-tight sm:inline">
            snaily<span className="text-primary">seo</span>
          </span>
        </Link>

        {/* ---------- Desktop sections ---------- */}
        <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
          {NAV.map((section) => {
            const Icon = section.icon;

            if (!section.items) {
              return (
                <Link
                  key={section.label}
                  href={section.href!}
                  aria-current={isActive(section.href!) ? "page" : undefined}
                  onMouseEnter={() => {
                    setOpen(null);
                  }}
                  className={cn(
                    "flex h-[54px] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13.5px] transition-colors",
                    isActive(section.href!)
                      ? "border-primary font-medium text-primary"
                      : "border-transparent text-nav-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {section.label}
                </Link>
              );
            }

            const sectionActive = section.items.some((i) => isActive(i.href));
            const isOpen = open === section.label;

            return (
              <div key={section.label} className="relative">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  onMouseEnter={() => {
                    setOpen(section.label);
                  }}
                  onClick={() => {
                    setOpen(isOpen ? null : section.label);
                  }}
                  className={cn(
                    "flex h-[54px] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13.5px] transition-colors",
                    sectionActive
                      ? "border-primary font-medium text-primary"
                      : isOpen
                        ? "border-transparent text-foreground"
                        : "border-transparent text-nav-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {section.label}
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      isOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>

                {isOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-50 min-w-60 overflow-hidden rounded-b-lg border-x border-b border-border bg-popover py-1 text-popover-foreground shadow-xl"
                  >
                    {section.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        title={item.note}
                        className={cn(
                          "flex items-center justify-between gap-3 px-3.5 py-2 text-sm transition-colors",
                          isActive(item.href)
                            ? "bg-primary/10 font-medium text-primary"
                            : "hover:bg-accent",
                        )}
                      >
                        {item.label}
                        {item.badge !== undefined && (
                          <span className="rounded bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="flex-1" />

        {children}

        <button
          type="button"
          aria-expanded={drawer}
          aria-label={drawer ? "Close menu" : "Open menu"}
          onClick={() => {
            setDrawer((d) => !d);
          }}
          className="rounded-md p-2 text-nav-muted hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        >
          {drawer ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* ---------- Mobile drawer ---------- */}
      {drawer && (
        <nav
          aria-label="Main, mobile"
          className="max-h-[70svh] overflow-y-auto border-t border-border bg-nav p-2 lg:hidden"
        >
          {/* Both owner-only pages 404 for a member, so neither is listed. */}
          {FLAT_NAV.filter(
            (i) => isOwner || (i.href !== "/users" && i.href !== "/integrations"),
          ).map(
            ({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors",
                  isActive(href)
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-nav-muted hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {label}
              </Link>
            ),
          )}
        </nav>
      )}
    </header>
  );
}

/** Links shown inside the account dropdown in the header. */
export function accountLinks(isOwner: boolean) {
  return isOwner ? [...ACCOUNT_NAV, ...OWNER_NAV] : ACCOUNT_NAV;
}
