"use client";

import { AlertTriangle, Check, FileText, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Which WordPress post the Drafter duplicates on Send to WordPress.
 *
 * Candidates are real synced posts, so the owner picks one rather than typing
 * an ID. Nothing on the site is changed by choosing — the template post is
 * only ever read.
 */

type Candidate = {
  wpId: number;
  title: string;
  status: string;
  matchedSections: number;
  sections: string[];
};

type Payload = {
  configuredId: number | null;
  active: {
    wpId: number;
    title: string;
    status: string;
    configured: boolean;
    sections: { key: string; label: string }[];
    unknownHeadings: string[];
  } | null;
  error: string | null;
  candidates: Candidate[];
};

export function WordpressTemplateCard({
  projectId,
  connected,
}: {
  projectId: string;
  connected: boolean;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/wordpress/template?projectId=${projectId}`);
      if (!res.ok) return;
      setData((await res.json()) as Payload);
    } catch {
      /* The card simply stays empty; nothing here blocks the page. */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  if (!connected) return null;

  async function choose(wpId: number | null) {
    setSaving(wpId ?? -1);
    try {
      const res = await fetch("/api/wordpress/template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, wpId }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Could not save the template.");
        return;
      }
      toast.success(
        wpId === null
          ? "Back to detecting the template automatically"
          : "Blog post template saved",
      );
      await load();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Blog post template</CardTitle>
            <CardDescription>
              Send to WordPress duplicates this post and fills its sections. The
              template itself is never edited or published.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => void load()}
            aria-label="Refresh template list"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {data === null ? (
          <p className="text-sm text-muted-foreground">
            {loading ? "Looking for your template…" : "No template information yet."}
          </p>
        ) : (
          <>
            {data.error !== null ? (
              <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {data.error}
              </p>
            ) : data.active !== null ? (
              <div className="rounded-md border border-border p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  {data.active.title}
                  <span className="text-xs font-normal text-muted-foreground">
                    #{data.active.wpId} · {data.active.status}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.active.configured
                    ? "Pinned in settings."
                    : "Detected automatically. Pick it below to pin it."}{" "}
                  Sections mapped: {data.active.sections.map((s) => s.label).join(", ")}.
                </p>
                {data.active.unknownHeadings.length > 0 ? (
                  <p className="mt-1 text-xs text-warning">
                    Not recognised, and left untouched on export:{" "}
                    {data.active.unknownHeadings.join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {data.candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No post on the site looks like a blog post template. Sync
                WordPress, then check the post is named something like
                &ldquo;Blog Post Template&rdquo;.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.candidates.map((c) => {
                  const active = data.configuredId === c.wpId;
                  return (
                    <li
                      key={c.wpId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block break-words font-medium">{c.title}</span>
                        <span className="text-xs text-muted-foreground">
                          #{c.wpId} · {c.status} · {c.matchedSections} sections
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant={active ? "outline" : "default"}
                        disabled={saving !== null}
                        onClick={() => void choose(active ? null : c.wpId)}
                      >
                        {saving === c.wpId ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : active ? (
                          <>
                            <Check className="size-3.5" aria-hidden />
                            Pinned
                          </>
                        ) : (
                          "Use this"
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
