import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A dense, scannable table.
 *
 * Screens were each writing their own `<table>` with their own padding, border
 * and header treatment, so two tables in the same product looked like two
 * products. These are thin wrappers — the point is that everyone gets the same
 * row height, the same hairlines and the same hover.
 *
 * The wrapper scrolls horizontally on its own so a wide table never makes the
 * page scroll sideways, which is the usual way a table breaks a layout on a
 * phone.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/40 data-[state=open]:bg-muted/40",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-9 px-3 text-left align-middle text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        "whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td className={cn("px-3 py-2 align-middle", className)} {...props} />
  );
}

/**
 * A header cell that sorts.
 *
 * The arrow only appears on the active column: an indicator on every column is
 * noise, and an indicator on none leaves the reader guessing what they are
 * looking at.
 */
function TableSortHead({
  active,
  direction = "desc",
  onSort,
  children,
  className,
  ...props
}: React.ComponentProps<"th"> & {
  active?: boolean;
  direction?: "asc" | "desc";
  onSort?: () => void;
}) {
  return (
    <TableHead
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("p-0", className)}
      {...props}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "flex h-9 w-full items-center gap-1 px-3 text-left transition-colors hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "text-foreground",
        )}
      >
        {children}
        <span aria-hidden className="text-[9px] leading-none">
          {active ? (direction === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </TableHead>
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableSortHead,
};
