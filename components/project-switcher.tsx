"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ProjectDialog } from "@/components/project-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectDTO } from "@/lib/projects";

type Props = {
  projects: ProjectDTO[];
  activeId: string | null;
};

export function ProjectSwitcher({ projects, activeId }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const active = projects.find((p) => p.id === activeId);

  async function selectProject(id: string) {
    if (id === activeId) return;
    try {
      const res = await fetch("/api/projects/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        toast.error("Could not switch project");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Could not switch project. Check your connection.");
    }
  }

  // Sits inside the navigation bar, which is white — keep it quiet so it reads
  // as chrome rather than a primary action.
  const triggerClass = "h-8 text-[13px] font-normal text-nav-muted";

  if (projects.length === 0) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className={triggerClass}
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus />
          Add project
        </Button>
        <ProjectDialog open={creating} onOpenChange={setCreating} />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={`max-w-[min(14rem,45vw)] justify-between gap-2 sm:max-w-56 ${triggerClass}`}
          >
            <span className="truncate">{active?.name ?? "Select project"}</span>
            <ChevronsUpDown className="shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Projects
          </DropdownMenuLabel>

          {projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => void selectProject(p.id)}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === activeId && <Check className="shrink-0 opacity-70" />}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setCreating(true);
            }}
          >
            <Plus />
            Add project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
