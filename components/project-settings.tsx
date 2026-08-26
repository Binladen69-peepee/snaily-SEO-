"use client";

import { ArrowLeft, Globe, Loader2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ProjectDialog } from "@/components/project-dialog";
import { CardHeading } from "@/components/setup/card-heading";
import { WordpressSettingsCard } from "@/components/setup/wordpress-settings-card";
import { WordpressTemplateCard } from "@/components/setup/wp-template-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectDTO } from "@/lib/projects";
import type { SetupSnapshot } from "@/lib/setup/state";

export function ProjectSettings({
  project,
  snapshot,
}: {
  project: ProjectDTO;
  snapshot: SetupSnapshot | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    setDeleting(true);
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      toast.error("Could not delete this project");
      setDeleting(false);
      return;
    }

    toast.success("Project deleted");
    router.push("/projects");
    router.refresh();
  }

  return (
    /*
     * No max-width here. This used to be max-w-2xl inside a max-w-3xl page, so
     * the Google card rendered as a sibling was visibly wider than everything
     * above it. The page owns the measure; every card fills it.
     */
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/projects">
            <ArrowLeft />
            Projects
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {project.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything this project connects to, and what each connection is for.
        </p>
      </div>

      <Card>
        <CardHeading
          icon={<Globe className="size-4.5" aria-hidden />}
          title="Website"
          description="The site every audit, crawl and draft in this project points at."
        />
        <CardContent className="space-y-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="mt-0.5 font-medium">{project.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">URL</dt>
              <dd className="mt-0.5 min-w-0">
                <a
                  href={project.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium break-all text-primary hover:underline"
                >
                  {project.url.replace(/^https?:\/\//, "")}
                </a>
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Description</dt>
              <dd
                className={
                  project.description ? "mt-0.5" : "mt-0.5 text-muted-foreground"
                }
              >
                {project.description || "None"}
              </dd>
            </div>
          </dl>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(true);
            }}
          >
            <Pencil />
            Edit details
          </Button>
        </CardContent>
      </Card>

      <WordpressSettingsCard projectId={project.id} snapshot={snapshot} />

      <WordpressTemplateCard
        projectId={project.id}
        connected={snapshot?.wordpress.health === "connected"}
      />

      <Card className="border-destructive/30">
        <CardHeading
          tone="danger"
          icon={<Trash2 className="size-4.5" aria-hidden />}
          title="Delete project"
          description="Permanently removes this project and all of its data. This cannot be undone."
        />
        <CardContent>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setConfirmText("");
              setConfirming(true);
            }}
          >
            <Trash2 />
            Delete project
          </Button>
        </CardContent>
      </Card>

      <ProjectDialog
        open={editing}
        onOpenChange={setEditing}
        project={project}
      />

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {project.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the project and all of its data. Type the
              project name to confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm">Project name</Label>
            <Input
              id="confirm"
              value={confirmText}
              onChange={(e) => {
                setConfirmText(e.target.value);
              }}
              placeholder={project.name}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== project.name || deleting}
              onClick={() => void onDelete()}
            >
              {deleting && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
