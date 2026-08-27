import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A short, coloured message about the thing next to it.
 *
 * Built the same way as Badge — cva variants over the same semantic tokens —
 * so a warning here and a warning badge are the same warning. Screens were
 * hand-rolling `rounded-md border border-warning/40 bg-warning/5 …` in a dozen
 * places, which is how two warnings end up different colours.
 */
const alertVariants = cva(
  "relative flex w-full gap-2.5 rounded-lg border px-3 py-2.5 text-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-muted/40 text-foreground",
        info: "border-primary/25 bg-primary/5 text-foreground",
        success: "border-success/30 bg-success/10 text-foreground",
        warning: "border-warning/35 bg-warning/10 text-foreground",
        destructive: "border-destructive/30 bg-destructive/10 text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p className={cn("font-medium leading-snug", className)} {...props} />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-xs leading-snug text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
