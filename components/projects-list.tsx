"use client";

import { ExternalLink, Globe, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ProjectDialog } from "@/components/project-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ProjectDTO } from "@/lib/projects";

export function ProjectsList({ projects }: { projects: ProjectDTO[] }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Each project is one website you want to analyze.
          </p>
        </div>
        <Button
          className="shrink-0 self-start"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus />
          Add project
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted">
              <Globe className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No projects yet</p>
              <p className="text-sm text-muted-foreground">
                Add your first website to get started.
              </p>
            </div>
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus />
              Add project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {projects.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                  {p.name.charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1 truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {p.url.replace(/^https?:\/\//, "")}
                    <ExternalLink className="size-3 shrink-0" aria-hidden />
                    <span className="sr-only">(opens in new tab)</span>
                  </a>
                  {p.description !== "" && (
                    <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                </div>

                <Button variant="outline" size="sm" asChild className="shrink-0 self-start sm:self-center">
                  <Link href={`/projects/${p.id}`}>
                    <Settings />
                    Settings
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
