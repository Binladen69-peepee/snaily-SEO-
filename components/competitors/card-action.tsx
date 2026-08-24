"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Shared outline / solid action buttons used on Explorer cards. */
export function CardAction({
  href,
  children,
  variant = "outline",
  onClick,
}: {
  href?: string;
  children: ReactNode;
  variant?: "outline" | "solid";
  onClick?: () => void;
}) {
  const className = cn(
    "inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3.5 text-xs font-semibold transition-colors",
    variant === "solid"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border border-primary bg-card text-primary hover:bg-primary/5",
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}
