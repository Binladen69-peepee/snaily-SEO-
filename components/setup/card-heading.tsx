/**
 * One heading shape for every card on Project settings.
 *
 * Each card was building its own header, so they disagreed on where the title
 * sat, whether there was an icon, and where a status badge went. The result
 * read as a stack of unrelated boxes rather than one screen.
 *
 * The shape is: a mark, the title and its purpose, and — pushed to the far
 * edge — whatever status that card has. The mark is the point: a card about
 * WordPress carries WordPress's logo, so the reader knows what the card is for
 * before reading a word of it.
 */

import type { ReactNode } from "react";

import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CardHeading({
  icon,
  title,
  description,
  status,
  tone = "default",
}: {
  /** The service's own mark, or a lucide icon for cards with no brand. */
  icon: ReactNode;
  title: string;
  description: ReactNode;
  /** Status badge, aligned to the trailing edge. */
  status?: ReactNode;
  /** `danger` tints the tile and title for destructive cards. */
  tone?: "default" | "danger";
}) {
  return (
    <CardHeader>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
            tone === "danger"
              ? "border-destructive/20 bg-destructive/10 text-destructive"
              : "border-border bg-muted/60 text-foreground",
          )}
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <CardTitle
            className={cn(
              "text-base leading-tight",
              tone === "danger" && "text-destructive",
            )}
          >
            {title}
          </CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>

        {status !== undefined && (
          <div className="shrink-0 pt-0.5">{status}</div>
        )}
      </div>
    </CardHeader>
  );
}
