"use client";

import { Printer } from "lucide-react";

/**
 * Opens the browser print dialog, which offers "Save as PDF" on every major
 * platform. A print stylesheet in globals.css strips the app chrome, so no PDF
 * library is needed.
 */
export function PrintButton({ label = "Export PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-card px-3 text-[12.5px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden"
      onClick={() => {
        window.print();
      }}
    >
      <Printer className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
