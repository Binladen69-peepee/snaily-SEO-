"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A secret field with a reveal toggle.
 *
 * Masked by default, because these render on a screen someone may well be
 * sharing. The toggle is a real button rather than a click target on the
 * input, so it is reachable by keyboard and announces its state.
 *
 * The value is never written anywhere but this input: no browser storage, no
 * URL, no logging. What the server sends back is already masked, so a field
 * showing `abcd••••wxyz` is showing a preview and not a secret — `hasStored`
 * is what tells the caller to render it as a placeholder instead.
 */
export function PasswordInput({
  className,
  revealLabel = "Show",
  hideLabel = "Hide",
  ...props
}: React.ComponentProps<typeof Input> & {
  revealLabel?: string;
  hideLabel?: string;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        className={cn("pr-9", className)}
      />
      <button
        type="button"
        onClick={() => {
          setVisible((v) => !v);
        }}
        aria-label={visible ? hideLabel : revealLabel}
        aria-pressed={visible}
        title={visible ? hideLabel : revealLabel}
        className={cn(
          "absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md",
          "text-muted-foreground transition-colors hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {visible ? (
          <EyeOff className="size-3.5" aria-hidden />
        ) : (
          <Eye className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}
