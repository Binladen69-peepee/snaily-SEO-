"use client";

import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { SetupIndicator } from "@/components/setup/setup-indicator";
import { ProjectSwitcher } from "@/components/project-switcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { accountLinks } from "@/components/top-nav";
import type { ProjectDTO } from "@/lib/projects";

type HeaderProps = {
  name: string;
  email: string;
  projects: ProjectDTO[];
  activeProjectId: string | null;
  /** Users and Integrations are owner-only and 404 for anyone else. */
  isOwner: boolean;
};

export function Header({
  name,
  email,
  projects,
  activeProjectId,
  isOwner,
}: HeaderProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  async function logout() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        toast.error("Could not sign out. Please try again.");
        return;
      }
      toast.success("Signed out");
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out. Check your connection.");
    }
  }

  return (
    <div className="nav-type flex min-w-0 items-center gap-1.5">
      <SetupIndicator />
      <div className="hidden min-w-0 md:block">
        <ProjectSwitcher projects={projects} activeId={activeProjectId} />
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="text-nav-muted hover:bg-accent hover:text-foreground"
        onClick={() => {
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
        }}
        aria-label={
          resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        }
      >
        <Sun className="size-4 dark:hidden" aria-hidden />
        <Moon className="hidden size-4 dark:block" aria-hidden />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Account menu"
          >
            <Avatar>
              <AvatarFallback className="bg-primary text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="nav-type w-56">
          <DropdownMenuLabel>
            <div className="truncate">{name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/*
            Built from the shared nav config rather than hardcoded here. The
            owner-only entries were previously listed unconditionally, so a
            member was offered Users and Integrations and got a 404 from both.
          */}
          {accountLinks(isOwner).map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href}>{item.label}</Link>
            </DropdownMenuItem>
          ))}

          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
