"use client";

import { ChevronDown, Menu, Snail, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ProjectSwitcher } from "@/components/project-switcher";
import { ACCOUNT_NAV, FLAT_NAV, NAV, OWNER_NAV } from "@/lib/nav";
import type { ProjectDTO } from "@/lib/projects";
import { cn } from "@/lib/utils";

/**
 * Primary navigation, laid out like KeySearch: one dark horizontal bar with
 * hover-opening dropdown sections, rather than a sidebar.
 */
export function TopNav({
  isOwner,
  children,
  projects = [],
  activeProjectId = null,
}: {
  isOwner: boolean;
  /** Account controls rendered on the right of the bar. */
  children?: React.ReactNode;
  projects?: ProjectDTO[];
  activeProjectId?: string | null;
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
        className="app-gutter nav-type flex h-[56px] min-w-0 items-center gap-0.5"
        onMouseLeave={() => {
          setOpen(null);
        }}
      >
        <Link
          href="/keywords"
          className="mr-3 flex shrink-0 items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:mr-6"
        >
          <Snail className="size-5 text-primary" aria-hidden />
          {/*
            The wordmark is set tighter than the nav labels rather than bolder.
            At 17px a semibold geometric sans beside 13px labels reads as two
            unrelated typefaces; medium weight with real negative tracking keeps
            it the same voice, just louder.
          */}
          <span className="hidden text-[17px] font-medium tracking-[-0.02em] sm:inline">
            snaily<span className="text-primary">seo</span>
          </span>
        </Link>

        {/* ---------- Desktop sections ---------- */}
        <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 xl:flex">
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
                    "flex h-[56px] max-w-[13rem] items-center gap-1.5 truncate border-b-2 px-2.5 text-[13.5px] transition-colors 2xl:max-w-none 2xl:px-3.5",
                    isActive(section.href!)
                      ? "border-primary font-medium text-primary"
                      : "border-transparent font-normal text-nav-muted hover:text-foreground",
                  )}
                >
                  <Icon className="hidden size-4 shrink-0 2xl:block" aria-hidden />
                  <span className="truncate">{section.label}</span>
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
                    "flex h-[56px] max-w-[14rem] items-center gap-1.5 truncate border-b-2 px-2.5 text-[13.5px] transition-colors 2xl:max-w-none 2xl:px-3.5",
                    sectionActive
                      ? "border-primary font-medium text-primary"
                      : isOpen
                        ? "border-transparent font-normal text-foreground"
                        : "border-transparent font-normal text-nav-muted hover:text-foreground",
                  )}
                >
                  <Icon className="hidden size-4 shrink-0 2xl:block" aria-hidden />
                  <span className="truncate">{section.label}</span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 shrink-0 transition-transform",
                      isOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>

                {isOpen && (
                  <div
                    role="menu"
                    className="nav-type absolute left-0 top-full z-50 min-w-60 overflow-hidden rounded-b-lg border-x border-b border-border bg-popover py-1.5 text-popover-foreground shadow-xl"
                  >
                    {section.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        title={item.note}
                        className={cn(
                          "flex items-center justify-between gap-3 px-3.5 py-2 text-[13.5px] transition-colors",
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

        <div className="min-w-0 flex-1" />

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          {children}
        </div>

        <button
          type="button"
          aria-expanded={drawer}
          aria-label={drawer ? "Close menu" : "Open menu"}
          onClick={() => {
            setDrawer((d) => !d);
          }}
          className="rounded-md p-2 text-nav-muted hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary xl:hidden"
        >
          {drawer ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* ---------- Mobile / tablet drawer (until xl) ---------- */}
      {drawer && (
        <nav
          aria-label="Main, mobile"
          className="app-gutter nav-type max-h-[min(70svh,32rem)] overflow-y-auto overscroll-contain border-t border-border bg-nav py-2 xl:hidden"
        >
          {projects.length > 0 && (
            <div className="mb-2 border-b border-border pb-3 pt-1 md:hidden">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-nav-muted">
                Active project
              </p>
              <ProjectSwitcher projects={projects} activeId={activeProjectId} />
            </div>
          )}

          {/* Both owner-only pages 404 for a member, so neither is listed. */}
          {FLAT_NAV.filter(
            (i) => isOwner || (i.href !== "/users" && i.href !== "/integrations"),
          ).map(
            ({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "-mx-1.5 flex items-center gap-2.5 rounded-md px-3 py-2.5 text-[13.5px] transition-colors",
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
