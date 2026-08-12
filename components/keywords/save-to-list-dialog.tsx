"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { Row } from "@/components/keywords/bulk-table";
import { Button } from "@/components/ui/button";
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

type ListOption = { id: string; name: string; count: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keywords: Row[];
  projectId: string | null;
  country: string;
  onSaved: () => void;
};

export function SaveToListDialog({
  open,
  onOpenChange,
  keywords,
  projectId,
  country,
  onSaved,
}: Props) {
  const router = useRouter();
  const [lists, setLists] = useState<ListOption[]>([]);
  const [target, setTarget] = useState("__new__");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || projectId === null) return;

    void fetch(`/api/lists?projectId=${projectId}`)
      .then((r) => r.json() as Promise<{ lists?: ListOption[] }>)
      .then((d) => {
        setLists(d.lists ?? []);
      });
  }, [open, projectId]);

  async function save() {
    if (projectId === null) return;
    setSaving(true);
    setError(null);

    const isNew = target === "__new__";
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        country,
        ...(isNew ? { name: name.trim() } : { listId: target }),
        keywords: keywords.map((k) => ({
          keyword: k.keyword,
          volume: k.volume,
          difficulty: k.difficulty,
          cpc: k.cpc,
          competition: k.competition,
          intent: k.intent,
          opportunity: k.opportunity,
        })),
      }),
    });

    const data = (await res.json()) as {
      error?: string;
      added?: number;
      skipped?: number;
    };

    if (!res.ok) {
      setError(data.error ?? "Could not save. Please try again.");
      setSaving(false);
      return;
    }

    const skipped = data.skipped ?? 0;
    toast.success(
      `Saved ${String(data.added ?? 0)} keyword${data.added === 1 ? "" : "s"}` +
        (skipped > 0 ? ` · ${String(skipped)} already in list` : ""),
    );

    setSaving(false);
    setName("");
    onOpenChange(false);
    onSaved();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save to list</DialogTitle>
          <DialogDescription>
            Saving {keywords.length} keyword{keywords.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        {projectId === null ? (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
            Create a project first — keyword lists are saved per project.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="target">List</Label>
              <select
                id="target"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                }}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="__new__">Create a new list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.count})
                  </option>
                ))}
              </select>
            </div>

            {target === "__new__" && (
              <div className="space-y-2">
                <Label htmlFor="listName">List name</Label>
                <Input
                  id="listName"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                  placeholder="Q4 content ideas"
                  maxLength={100}
                />
              </div>
            )}

            {error !== null && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={
              saving ||
              projectId === null ||
              (target === "__new__" && name.trim() === "")
            }
          >
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
