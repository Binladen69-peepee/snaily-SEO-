"use client";

/**
 * The only issue on this screen with a Fix button.
 *
 * Everything else the audit reports needs a decision a person has to make —
 * which duplicate title to rewrite, what a thin page should say, whether a
 * dead URL should come back or redirect. Those show "Review manually", because
 * a button that guesses is worse than no button.
 *
 * Alt text is different only because the author supplies the words. Once they
 * have, putting them on the right image is deterministic, and the connector
 * reads the value back so "Fixed" means WordPress actually holds it.
 */

import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type RowState =
  | { kind: "open" }
  | { kind: "fixing" }
  | { kind: "fixed"; alt: string }
  | { kind: "failed"; message: string }
  | { kind: "manual"; message: string };

function fileName(src: string): string {
  try {
    return new URL(src, "https://example.invalid").pathname.split("/").pop() ?? src;
  } catch {
    return src;
  }
}

export function AltFixPanel({
  auditId,
  pageUrl,
  images,
  onFixed,
}: {
  auditId: string;
  pageUrl: string;
  /** The srcs this audit flagged on this page. */
  images: string[];
  /** Called with the number still outstanding, so counts stay honest. */
  onFixed?: (remaining: number) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, RowState>>({});

  async function fix(src: string) {
    const alt = (drafts[src] ?? "").trim();
    if (alt === "") {
      toast.error("Write the alt text first.");
      return;
    }

    setStates((s) => ({ ...s, [src]: { kind: "fixing" } }));

    try {
      const res = await fetch("/api/content/fix-alt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId, pageUrl, src, alt }),
      });
      const data = (await res.json()) as {
        state?: string;
        message?: string;
        error?: string;
        alt?: string;
        remaining?: number;
      };

      if (data.state === "fixed" || data.state === "already") {
        setStates((s) => ({
          ...s,
          [src]: { kind: "fixed", alt: data.alt ?? alt },
        }));
        if (typeof data.remaining === "number") onFixed?.(data.remaining);
        toast.success(
          data.state === "already"
            ? "That image already had this alt text."
            : "Alt text saved to WordPress.",
        );
        return;
      }

      if (data.state === "manual_review") {
        setStates((s) => ({
          ...s,
          [src]: { kind: "manual", message: data.error ?? "Needs a manual fix." },
        }));
        return;
      }

      setStates((s) => ({
        ...s,
        [src]: { kind: "failed", message: data.error ?? "The fix did not apply." },
      }));
      toast.error(data.error ?? "The fix did not apply.");
    } catch {
      setStates((s) => ({
        ...s,
        [src]: { kind: "failed", message: "Could not reach the server." },
      }));
    }
  }

  if (images.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">
        Write what each image shows. Snaily saves it to the image in your media
        library and reads it back to confirm — the page itself is never edited.
      </p>

      {images.map((src) => {
        const state = states[src] ?? { kind: "open" };
        const busy = state.kind === "fixing";
        const done = state.kind === "fixed";

        return (
          <div
            key={src}
            className={cn(
              "rounded-lg border p-3",
              done ? "border-success/30 bg-success/5" : "border-border",
            )}
          >
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                className="size-12 shrink-0 rounded border border-border object-cover"
                loading="lazy"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <code className="truncate text-[11px] text-muted-foreground">
                    {fileName(src)}
                  </code>
                  <a
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Open the image"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                </div>

                {done ? (
                  <p className="flex items-center gap-1.5 text-xs text-success">
                    <Check className="size-3.5" aria-hidden />
                    Fixed — “{state.alt}”
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={drafts[src] ?? ""}
                      disabled={busy}
                      maxLength={500}
                      placeholder="What does this image show?"
                      onChange={(e) => {
                        const next = e.target.value;
                        setDrafts((d) => ({ ...d, [src]: next }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void fix(src);
                        }
                      }}
                      className="h-8 min-w-0 flex-1 text-xs"
                    />
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={busy || (drafts[src] ?? "").trim() === ""}
                      onClick={() => void fix(src)}
                    >
                      {busy && <Loader2 className="animate-spin" />}
                      {busy
                        ? "Fixing…"
                        : state.kind === "failed"
                          ? "Retry"
                          : "Fix"}
                    </Button>
                  </div>
                )}

                {state.kind === "failed" && (
                  <Alert variant="destructive" className="py-2">
                    <AlertTriangle aria-hidden />
                    <AlertDescription className="text-foreground">
                      {state.message}
                    </AlertDescription>
                  </Alert>
                )}
                {state.kind === "manual" && (
                  <Alert variant="warning" className="py-2">
                    <AlertTriangle aria-hidden />
                    <AlertDescription className="text-foreground">
                      Review manually — {state.message}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
