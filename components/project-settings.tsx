"use client";

import { ArrowLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ProjectDialog } from "@/components/project-dialog";
import { WordpressSettingsCard } from "@/components/setup/wordpress-settings-card";
import { WordpressTemplateCard } from "@/components/setup/wp-template-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <div className="mx-auto max-w-2xl space-y-6">
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
        <p className="text-sm text-muted-foreground">Project settings</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Website name</dt>
              <dd className="font-medium">{project.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Website URL</dt>
              <dd className="font-medium break-all">{project.url}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Description</dt>
              <dd className={project.description ? "" : "text-muted-foreground"}>
                {project.description || "None"}
              </dd>
            </div>
          </dl>

          <Button
            variant="outline"
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

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            Delete project
          </CardTitle>
          <CardDescription>
            Permanently removes this project and all of its data. This cannot be
            undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
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
