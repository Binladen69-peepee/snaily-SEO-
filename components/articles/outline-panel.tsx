"use client";

import { AlertTriangle, Hash, XCircle } from "lucide-react";
import { useMemo } from "react";

import { buildOutline } from "@/lib/drafter/outline";
import { cn } from "@/lib/utils";

/**
 * Heading navigator and structure check.
 *
 * Doubles as a table of contents and a lint pass: the same heading tree that
 * lets an author jump around a 2,000-word post is the one Google reads to work
 * out what the page covers, so a hole in it costs twice.
 */
export function OutlinePanel({
  html,
  onJump,
}: {
  html: string;
  /** Scroll the editor to the nth heading. */
  onJump: (index: number) => void;
}) {
  const outline = useMemo(() => buildOutline(html), [html]);

  const errors = outline.problems.filter((p) => p.severity === "error");
  const warnings = outline.problems.filter((p) => p.severity === "warning");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {outline.nodes.length === 0
            ? "No headings yet"
            : `${String(outline.nodes.length)} heading${
                outline.nodes.length === 1 ? "" : "s"
              }`}
        </p>
        {errors.length > 0 && (
          <span className="rounded bg-destructive/12 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
            {errors.length} problem{errors.length === 1 ? "" : "s"}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning-foreground">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {outline.problems.length > 0 && (
        <ul className="space-y-1.5">
          {outline.problems.map((p, i) => (
            <li
              key={`${String(p.at)}-${String(i)}`}
              className={cn(
                "flex gap-2 rounded-md border px-2.5 py-2 text-xs",
                p.severity === "error"
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-warning/40 bg-warning/5",
              )}
            >
              {p.severity === "error" ? (
                <XCircle className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden />
              ) : (
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
              )}
              <span>{p.message}</span>
            </li>
          ))}
        </ul>
      )}

      {outline.nodes.length > 0 && (
        <ul className="space-y-0.5">
          {outline.nodes.map((node, i) => (
            <li key={node.id}>
              <button
                type="button"
                onClick={() => {
                  onJump(i);
                }}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                  node.level === 3 && "pl-6",
                  node.level === 4 && "pl-10",
                )}
              >
                <Hash
                  className={cn(
                    "size-3 shrink-0 translate-y-0.5 text-muted-foreground",
                    node.level === 2 && "text-primary",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{node.text}</span>
                <span
                  className={cn(
                    "tabular shrink-0 text-[11px]",
                    node.words === 0
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {node.words === 0 ? "empty" : `${String(node.words)}w`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
