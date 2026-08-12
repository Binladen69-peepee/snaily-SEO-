"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { ScorePill } from "@/components/difficulty";
import { EqualizerLoader } from "@/components/ui/equalizer-loader";
import type { CompetitorRow, OrganicKeyword } from "@/lib/competitors";
import {
  formatCpc,
  formatNumber,
  formatVolume,
} from "@/lib/keywords/format";

export type PreviewKind = "keywords" | "backlinks" | "domains" | "pages";

type PreviewProps = {
  open: boolean;
  onClose: () => void;
  kind: PreviewKind;
  domain: string;
  keywords?: OrganicKeyword[];
  competitors?: CompetitorRow[];
  backlinks?: number;
  dofollow?: number;
  nofollow?: number;
  referringDomains?: number;
  citingPages?: number;
};

const TITLES: Record<PreviewKind, string> = {
  keywords: "Organic Keywords",
  backlinks: "Backlinks snapshot",
  domains: "Referring Domains",
  pages: "Top Pages",
};

/**
 * Quick-view popup for Explorer card actions — shortcut details before
 * opening the full tool.
 */
export function ExplorerPreviewModal({
  open,
  onClose,
  kind,
  domain,
  keywords = [],
  competitors = [],
  backlinks = 0,
  dofollow = 0,
  nofollow = 0,
  referringDomains = 0,
  citingPages = 0,
}: PreviewProps) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(() => {
      setLoading(false);
    }, 450);
    return () => {
      clearTimeout(t);
    };
  }, [open, kind, domain]);

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

  const fullHref =
    kind === "keywords"
      ? `/competitors/organic?domain=${encodeURIComponent(domain)}`
      : kind === "pages"
        ? `/competitors/url-metrics?url=${encodeURIComponent(`https://${domain}`)}`
        : `/competitors/backlinks?domain=${encodeURIComponent(domain)}`;

  const fullLabel =
    kind === "keywords"
      ? "Open Organic Keywords"
      : kind === "pages"
        ? "Open URL Metrics"
        : "Open Backlink Checker";

  let body: ReactNode;
  if (loading) {
    body = <EqualizerLoader label="Loading preview" className="py-16" />;
  } else if (kind === "keywords") {
    body =
      keywords.length === 0 ? (
        <Empty>No keywords to preview for {domain}.</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5">Keyword</th>
              <th className="px-2 py-2.5 text-right">Volume</th>
              <th className="px-2 py-2.5 text-right">CPC</th>
              <th className="px-4 py-2.5 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {keywords.slice(0, 12).map((k) => (
              <tr key={k.keyword} className="border-b border-border/70">
                <td className="max-w-[14rem] truncate px-4 py-2.5 font-medium">
                  {k.keyword}
                </td>
                <td className="tabular px-2 py-2.5 text-right">
                  {formatVolume(k.volume)}
                </td>
                <td className="tabular px-2 py-2.5 text-right">
                  {formatCpc(k.cpc)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <ScorePill score={k.difficulty} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  } else if (kind === "domains") {
    body =
      competitors.length === 0 ? (
        <Empty>No referring domains to preview yet.</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5">Site</th>
              <th className="px-2 py-2.5 text-right">DS</th>
              <th className="px-2 py-2.5 text-right">Links</th>
              <th className="px-4 py-2.5 text-right">Domains</th>
            </tr>
          </thead>
          <tbody>
            {competitors.slice(0, 12).map((c) => (
              <tr key={c.site} className="border-b border-border/70">
                <td className="px-4 py-2.5 font-medium text-primary">{c.site}</td>
                <td className="tabular px-2 py-2.5 text-right">
                  {c.ds.toFixed(1)}
                </td>
                <td className="tabular px-2 py-2.5 text-right">
                  {formatNumber(c.links)}
                </td>
                <td className="tabular px-4 py-2.5 text-right">
                  {formatNumber(c.domains)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  } else if (kind === "pages") {
    body = (
      <div className="space-y-3 px-4 py-5">
        <Stat label="Target domain" value={domain} />
        <Stat
          label="Homepage URL"
          value={`https://${domain}`}
          mono
        />
        <p className="text-sm text-muted-foreground">
          Open URL Metrics for a full page readout — word count, headings,
          response time, and on-page checks for any URL on this domain.
        </p>
      </div>
    );
  } else {
    // backlinks
    body = (
      <div className="grid grid-cols-2 gap-3 px-4 py-5 sm:grid-cols-3">
        <Stat label="Backlinks" value={formatNumber(backlinks)} />
        <Stat label="Dofollow" value={formatNumber(dofollow)} />
        <Stat label="Nofollow" value={formatNumber(nofollow)} />
        <Stat
          label="Referring domains"
          value={formatNumber(referringDomains)}
        />
        <Stat label="Citing pages (live)" value={formatNumber(citingPages)} />
      </div>
    );
  }

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
        aria-labelledby="explorer-preview-title"
        className="relative z-10 flex max-h-[min(85svh,36rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2
              id="explorer-preview-title"
              className="truncate text-base font-bold"
            >
              {TITLES[kind]}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{domain}</p>
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

        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            Close
          </button>
          <Link
            href={fullHref}
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {fullLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-12 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 truncate text-lg font-bold ${mono ? "font-mono text-sm" : "tabular"}`}
      >
        {value}
      </p>
    </div>
  );
}
