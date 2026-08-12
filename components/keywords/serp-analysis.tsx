"use client";

import { useState } from "react";

import {
  cellTint,
  linksBand,
  serpStats,
  SERP_METRIC_KEYS,
  SERP_METRIC_LABEL,
  SERP_METRIC_TITLE,
} from "@/lib/keywords/serp";
import type { SerpResult } from "@/lib/keywords/types";
import { UNAVAILABLE_NOTE } from "@/lib/keywords/authority";
import { ctrForPosition } from "@/lib/keywords/ctr";
import { formatNumber } from "@/lib/keywords/format";
import { cn } from "@/lib/utils";

const TABS = ["SERP Analysis", "Rankings/Traffic", "Social"] as const;
type Tab = (typeof TABS)[number];

/** Compact metric cell — big numbers stay readable. */
function metric(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 100_000) return `${Math.round(value / 1000).toString()}K`;
  return formatNumber(value);
}

function TabStrip({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-md bg-muted p-1" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === active}
          onClick={() => {
            onChange(tab);
          }}
          className={cn(
            "rounded px-3 py-1.5 text-[13px] transition-colors",
            tab === active
              ? "border border-border bg-card font-medium text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function SerpAnalysis({ results }: { results: SerpResult[] }) {
  const [tab, setTab] = useState<Tab>("SERP Analysis");
  const stats = serpStats(results);

  if (stats === null) {
    return (
      <section className="rounded border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          No first-page results available for this keyword.
        </p>
      </section>
    );
  }

  const band = stats.linksScore === null ? null : linksBand(stats.linksScore);

  return (
    <section className="rounded border border-border bg-card">
      <div className="px-3 pb-1 pt-3">
        <TabStrip active={tab} onChange={setTab} />
      </div>

      {tab === "SERP Analysis" && (
        <>
          {/* ---------- Top 10 with competitive metrics ---------- */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[42rem] text-[12.5px]">
              <caption className="sr-only">
                First page results with page and domain strength metrics
              </caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="px-3 py-1.5 text-left font-normal">
                    URL
                  </th>
                  {SERP_METRIC_KEYS.map((k) => (
                    <th
                      key={k}
                      scope="col"
                      title={SERP_METRIC_TITLE[k]}
                      className="px-1 py-1.5 text-center font-normal"
                    >
                      {SERP_METRIC_LABEL[k]}
                    </th>
                  ))}
                  <th
                    scope="col"
                    title="Keyword appears in the URL"
                    className="px-1 py-1.5 text-center font-normal"
                  >
                    URL
                  </th>
                </tr>
              </thead>

              <tbody>
                {results.map((r) => (
                  <tr key={r.position} className="border-b border-border/70">
                    <td className="max-w-[22rem] px-3 py-1.5">
                      <div className="flex items-start gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.favicon}
                          alt=""
                          width={16}
                          height={16}
                          loading="lazy"
                          className="mt-0.5 size-4 shrink-0 rounded-sm bg-muted"
                        />
                        <span className="min-w-0">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate font-medium text-foreground hover:text-primary hover:underline"
                            title={r.title}
                          >
                            {r.title}
                          </a>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {r.url}
                          </span>
                        </span>
                      </div>
                    </td>

                    {SERP_METRIC_KEYS.map((k) => {
                      const v = r[k];
                      return (
                        <td key={k} className="px-1 py-1.5">
                          <span
                            title={
                              v === null
                                ? UNAVAILABLE_NOTE
                                : `${SERP_METRIC_LABEL[k]}: ${String(v)}`
                            }
                            className={cn(
                              "tabular block rounded px-1.5 py-1 text-center",
                              v === null
                                ? "text-muted-foreground/60"
                                : cellTint(k, v),
                            )}
                          >
                            {v === null ? "N/A" : metric(v)}
                          </span>
                        </td>
                      );
                    })}

                    <td className="px-1 py-1.5">
                      <span
                        className={cn(
                          "block rounded px-1.5 py-1 text-center",
                          r.keywordInUrl ? "bg-cell-bad" : "bg-cell-good",
                        )}
                      >
                        {r.keywordInUrl ? "Yes" : "No"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            Summed stats sit beside the Links Score. Laid out as two boxes
            rather than one table with a spanning cell, because rowSpan cannot
            cross a thead/tbody boundary.
          */}
          <div className="flex flex-col border-t border-border lg:flex-row">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-[12.5px]">
                <caption className="sr-only">
                  Lowest and average metrics across the first page
                </caption>
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="px-3 py-2 text-left font-normal">
                      Summed Stats
                    </th>
                    {SERP_METRIC_KEYS.map((k) => (
                      <th
                        key={k}
                        scope="col"
                        title={SERP_METRIC_TITLE[k]}
                        className="border-l border-border px-2 py-2 text-left font-normal"
                      >
                        {SERP_METRIC_LABEL[k]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Lowest", stats.lowest],
                      ["Average", stats.average],
                    ] as const
                  ).map(([label, row]) => (
                    <tr key={label} className="border-b border-border/70">
                      <th
                        scope="row"
                        className="px-3 py-2 text-left font-normal"
                      >
                        {label}
                      </th>
                      {SERP_METRIC_KEYS.map((k) => (
                        <td
                          key={k}
                          className="tabular border-l border-border px-2 py-2 text-left"
                        >
                          {row[k] === null ? (
                            <span
                              className="text-muted-foreground"
                              title={UNAVAILABLE_NOTE}
                            >
                              N/A
                            </span>
                          ) : (
                            formatNumber(row[k])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-3 text-center lg:w-60 lg:border-l lg:border-t-0">
              <p
                className="text-[12.5px] text-muted-foreground"
                title="How hard the first page is to break into, 0–100"
              >
                ⓘ Links Score
              </p>
              {/*
                The score is built from PA and linking domains. Without a
                backlink provider there is nothing to build it from, and a
                placeholder number would read as a measurement.
              */}
              {stats.linksScore === null || band === null ? (
                <>
                  <p className="mt-0.5 text-2xl font-semibold text-muted-foreground">
                    N/A
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    Needs a backlink index. Keyword Difficulty above is measured
                    from the live SERP and is unaffected.
                  </p>
                </>
              ) : (
                <>
                  <p
                    className={cn(
                      "tabular mt-0.5 text-2xl font-semibold",
                      band.className,
                    )}
                  >
                    {stats.linksScore}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    You may need{" "}
                    {stats.domainsToRank === null
                      ? "an unknown number of"
                      : formatNumber(stats.domainsToRank)}{" "}
                    linking domains to rank on 1st page
                  </p>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "Rankings/Traffic" && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[12.5px]">
            <caption className="sr-only">
              Estimated traffic share for the first page
            </caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="px-3 py-1.5 text-left font-normal">
                  URL
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  Position
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  Est. CTR
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-normal">
                  Words
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.position} className="border-b border-border/70">
                  <td className="max-w-[24rem] px-3 py-1.5">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate hover:text-primary hover:underline"
                      title={r.title}
                    >
                      {r.domain}
                    </a>
                  </td>
                  <td className="tabular px-2 py-1.5 text-right">
                    {r.position}
                  </td>
                  <td className="tabular px-2 py-1.5 text-right">
                    {ctrForPosition(r.position).toFixed(1)}%
                  </td>
                  <td className="tabular px-3 py-1.5 text-right text-muted-foreground">
                    {r.wordCount > 0 ? formatNumber(r.wordCount) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Position is live from Google. Click-through rate is a published
            industry curve applied to that position, not measured traffic — only
            Search Console can measure your own.
          </p>
        </div>
      )}

      {tab === "Social" && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[30rem] text-[12.5px]">
            <caption className="sr-only">Social profile of each result</caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="px-3 py-1.5 text-left font-normal">
                  Domain
                </th>
                <th scope="col" className="px-3 py-1.5 text-left font-normal">
                  Signals
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.position} className="border-b border-border/70">
                  <td className="px-3 py-1.5">{r.domain}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    Not available
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Share counts need a social data provider. Facebook, X and Pinterest
            all closed their public count endpoints, so no free source reports
            them — this tab stays empty rather than showing invented numbers.
          </p>
        </div>
      )}
    </section>
  );
}
