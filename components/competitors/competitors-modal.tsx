"use client";

import { CloudDownload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { EqualizerLoader } from "@/components/ui/equalizer-loader";
import { formatNumber } from "@/lib/keywords/format";
import type { CompetitorRow } from "@/lib/competitors";
import { cn } from "@/lib/utils";

function downloadCsv(rows: CompetitorRow[], domain: string) {
  const header = "Site,DS,Links,Domains,Keywords";
  const body = rows
    .map(
      (r) =>
        `${r.site},${r.ds},${r.links},${r.domains},${r.keywords}`,
    )
    .join("\n");
  const blob = new Blob([`${header}\n${body}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${domain}-competitors.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CompetitorsModal({
  open,
  onClose,
  domain,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  domain: string;
  rows: CompetitorRow[];
}) {
  const [loading, setLoading] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(() => {
      setLoading(false);
    }, 700);
    return () => {
      clearTimeout(t);
    };
  }, [open, domain]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const top = rows.slice(0, 20);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog backdrop"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="competitors-modal-title"
        className="relative z-10 flex max-h-[min(85svh,36rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2
            id="competitors-modal-title"
            className="flex-1 text-base font-bold text-foreground"
          >
            Top {Math.min(20, top.length) || 20} Competitors
          </h2>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setExportOpen((o) => !o);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              <CloudDownload className="size-3.5" aria-hidden />
              Export
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-36 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    downloadCsv(top, domain);
                    setExportOpen(false);
                  }}
                >
                  Export CSV
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <EqualizerLoader label="Loading competitors" className="py-16" />
          ) : top.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No competitors found in cached SERPs yet. Research a few keywords
              first, then reopen this list.
            </p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">
                Top competitors found alongside {domain}
              </caption>
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5">
                    Site
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right">
                    DS
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right">
                    Links
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right">
                    Domains
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right">
                    Keywords
                  </th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.site} className="border-b border-border/70">
                    <td className="px-4 py-2.5">
                      <a
                        href={`https://${r.site}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        {r.site}
                      </a>
                    </td>
                    <td className="tabular px-2 py-2.5 text-right font-medium">
                      {r.ds === null ? "—" : r.ds.toFixed(1)}
                    </td>
                    <td className="tabular px-2 py-2.5 text-right">
                      {r.links === null ? "—" : `~${formatNumber(r.links)}`}
                    </td>
                    <td className="tabular px-2 py-2.5 text-right">
                      {r.domains === null ? "—" : `~${formatNumber(r.domains)}`}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">
                      {formatNumber(r.keywords)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">Found in SERPs</p>
          <Link
            href={`/competitor-gap?them=${encodeURIComponent(domain)}`}
            className={cn(
              "inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90",
            )}
            onClick={onClose}
          >
            Competitor Gap Tool
          </Link>
        </div>
      </div>
    </div>
  );
}
