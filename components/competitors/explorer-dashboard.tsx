"use client";

import { ArrowDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CASearchBar } from "@/components/competitors/ca-search-bar";
import { CompetitorsModal } from "@/components/competitors/competitors-modal";
import { CardAction } from "@/components/competitors/competitor-sub-nav";
import { DomainGauge } from "@/components/competitors/domain-gauge";
import {
  ExplorerPreviewModal,
  type PreviewKind,
} from "@/components/competitors/explorer-preview-modal";
import { OverviewChart } from "@/components/competitors/overview-chart";
import { ScorePill } from "@/components/difficulty";
import { EqualizerLoader } from "@/components/ui/equalizer-loader";
import type { ExplorerReport } from "@/lib/competitors";
import {
  formatCpc,
  formatNumber,
  formatVolume,
} from "@/lib/keywords/format";
import { cn } from "@/lib/utils";

/** @deprecated Prefer CASearchBar — kept for existing imports. */
export const ExplorerSearchBar = CASearchBar;

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CardFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/15 px-4 py-3">
      {children}
    </div>
  );
}

export function ExplorerDashboard({ report }: { report: ExplorerReport }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewKind | null>(null);
  const [chartTab, setChartTab] = useState<"backlinks" | "traffic">(
    "backlinks",
  );

  const maxDist = Math.max(
    1,
    ...report.rankingDistribution.map((b) => b.count),
  );

  const tipTarget = report.targetCompetition;
  const scorePct = Math.min(100, (report.competitionScore / 100) * 100);

  return (
    <>
      <div className="grid min-w-0 gap-3 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* ================= LEFT ================= */}
        <div className="space-y-3">
          <div className="grid min-w-0 gap-3 [&>*]:min-w-0 sm:grid-cols-2">
            <Card>
              <DomainGauge
                value={report.domainStrength}
                domain={report.domain}
              />
            </Card>

            <Card className="flex flex-col justify-center p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1 text-3xl font-bold text-success">
                    {report.competitionScore}
                    <ArrowDown className="size-4" aria-hidden />
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-success">
                    {report.competitionLabel}
                  </p>
                </div>
                <div className="text-right text-[11px] leading-relaxed text-muted-foreground">
                  <p>Competition Level</p>
                  <p className="font-semibold text-foreground">
                    Target Competition
                  </p>
                  <p
                    className="mt-1 inline-block rounded bg-success/15 px-1.5 py-0.5 font-bold text-success"
                  >
                    {report.competitionScore}
                  </p>
                </div>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-success transition-all"
                  style={{ width: `${String(scorePct)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Try to target competition of {tipTarget} or less
              </p>
            </Card>
          </div>

          {/* Organic Keywords */}
          <Card>
            <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Organic Keywords
                </p>
                <p className="text-3xl font-bold tabular">
                  {formatNumber(report.organicCount)}
                </p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {report.organicSource === "search-console"
                  ? "Measured · GSC"
                  : "Targeted · crawl"}
              </span>
            </div>

            <div className="min-w-0 flex-1 overflow-x-auto">
              <table className="w-full min-w-[21rem] text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Keyword</th>
                    <th className="px-2 py-2 text-right font-semibold">
                      Position
                    </th>
                    <th className="px-2 py-2 text-right font-semibold">
                      Volume
                    </th>
                    <th className="px-2 py-2 text-right font-semibold">
                      Traffic
                    </th>
                    <th className="px-2 py-2 text-right font-semibold">CPC</th>
                    <th className="px-3 py-2 text-right font-semibold">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {report.organicPreview.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-8 text-center text-muted-foreground"
                      >
                        No keywords found for this domain.
                      </td>
                    </tr>
                  ) : (
                    report.organicPreview.map((k) => (
                      <tr
                        key={k.keyword}
                        className="border-b border-border/60 hover:bg-muted/30"
                      >
                        <td className="max-w-[10rem] truncate px-3 py-2 font-medium">
                          <Link
                            href={`/keywords?q=${encodeURIComponent(k.keyword)}`}
                            className="hover:text-primary hover:underline"
                          >
                            {k.keyword}
                          </Link>
                        </td>
                        <td className="tabular px-2 py-2 text-right">
                          {k.position === null ? "—" : k.position.toFixed(1)}
                        </td>
                        <td className="tabular px-2 py-2 text-right">
                          {formatVolume(k.volume)}
                        </td>
                        <td className="tabular px-2 py-2 text-right">
                          {k.estTraffic === null
                            ? "—"
                            : formatNumber(k.estTraffic)}
                        </td>
                        <td className="tabular px-2 py-2 text-right">
                          {formatCpc(k.cpc)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ScorePill score={k.difficulty} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <CardFooter>
              <CardAction
                onClick={() => {
                  setPreview("pages");
                }}
              >
                View Top Pages
              </CardAction>
              <CardAction
                variant="solid"
                onClick={() => {
                  setPreview("keywords");
                }}
              >
                View Keywords
              </CardAction>
            </CardFooter>
          </Card>

          {/* Top Competitors preview */}
          <Card>
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-bold">Top Competitors</h3>
              <p className="text-[11px] text-muted-foreground">Found in SERPS</p>
            </div>
            <div className="min-w-0 flex-1 overflow-x-auto">
              <table className="w-full min-w-[20rem] text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Site</th>
                    <th className="px-2 py-2 text-right font-semibold">DS</th>
                    <th className="px-2 py-2 text-right font-semibold">Links</th>
                    <th className="px-2 py-2 text-right font-semibold">
                      Domains
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Keywords
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.competitors.slice(0, 5).map((c) => (
                    <tr key={c.site} className="border-b border-border/60">
                      <td className="px-3 py-2">
                        <a
                          href={`https://${c.site}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          {c.site}
                        </a>
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {c.ds.toFixed(1)}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {formatNumber(c.links)}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {formatNumber(c.domains)}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {formatNumber(c.keywords)}
                      </td>
                    </tr>
                  ))}
                  {report.competitors.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        No SERP competitors cached yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <CardFooter>
              <CardAction
                variant="solid"
                onClick={() => {
                  setModalOpen(true);
                }}
              >
                View Competitors
              </CardAction>
            </CardFooter>
          </Card>

          {/* Ranking distribution */}
          <Card className="p-4">
            <h3 className="text-sm font-bold">Ranking Distribution</h3>
            <p className="text-[11px] text-muted-foreground">Top 100 Split</p>
            <div className="mt-4 flex items-end gap-2" style={{ height: 100 }}>
              {report.rankingDistribution.map((b) => (
                <div
                  key={b.band}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="tabular text-[10px] font-medium text-muted-foreground">
                    {b.count}
                  </span>
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-primary to-indigo-400"
                    style={{
                      height: `${String(Math.max(6, (b.count / maxDist) * 80))}px`,
                    }}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {b.band}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ================= RIGHT ================= */}
        <div className="space-y-3">
          <div className="grid min-w-0 gap-3 [&>*]:min-w-0 sm:grid-cols-2">
            <Card className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    Backlinks
                  </p>
                  <p className="text-3xl font-bold tabular">
                    {formatNumber(report.backlinks)}
                  </p>
                </div>
                <CardAction
                  onClick={() => {
                    setPreview("backlinks");
                  }}
                >
                  View Backlinks
                </CardAction>
              </div>
              <dl className="mt-3 flex gap-4 text-xs text-muted-foreground">
                <div>
                  <dt>Dofollow</dt>
                  <dd className="tabular font-semibold text-foreground">
                    {formatNumber(report.dofollow)}
                  </dd>
                </div>
                <div>
                  <dt>Nofollow</dt>
                  <dd className="tabular font-semibold text-foreground">
                    {formatNumber(report.nofollow)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Authority figures estimated · {report.citingPages} live citing
                pages
              </p>
            </Card>

            <Card className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    Referring Domains
                  </p>
                  <p className="text-3xl font-bold tabular">
                    {formatNumber(report.referringDomains)}
                  </p>
                </div>
                <CardAction
                  onClick={() => {
                    setPreview("domains");
                  }}
                >
                  View Domains
                </CardAction>
              </div>
              <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <dt>Keysearch Rank</dt>
                  <dd className="tabular font-semibold text-foreground">
                    {Math.max(1, Math.round(11 - report.domainStrength))}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Keysearch DS</dt>
                  <dd className="tabular font-semibold text-foreground">
                    {report.domainStrength.toFixed(1)}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
              {(
                [
                  ["backlinks", "Backlinks Overview"],
                  ["traffic", "Traffic Overview"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setChartTab(id);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    chartTab === id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="p-3">
              <p className="mb-2 text-sm font-semibold">
                {report.dofollowPct.toFixed(2)}% Dofollow Percentage
              </p>
              <OverviewChart
                values={
                  chartTab === "backlinks"
                    ? report.trend
                    : report.trend.map((v) => Math.round(v * 0.22))
                }
              />
              <p className="mt-2 text-[10px] text-muted-foreground">
                Trend Chart: A general overview of links found over time. May
                not be exact.
              </p>
            </div>
          </Card>

          <Card>
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-bold">Top DS Referring Domains</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Site</th>
                    <th className="px-2 py-2 text-right font-semibold">DS</th>
                    <th className="px-2 py-2 text-right font-semibold">Links</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Domains
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.referringPreview.map((c) => (
                    <tr key={`ref-${c.site}`} className="border-b border-border/60">
                      <td className="px-3 py-2">
                        <a
                          href={`https://${c.site}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          {c.site}
                        </a>
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {c.ds.toFixed(1)}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {formatNumber(c.links)}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {formatNumber(Math.max(1, Math.round(c.domains * 0.01)))}
                      </td>
                    </tr>
                  ))}
                  {report.referringPreview.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        No referring domains to show yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <CompetitorsModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
        }}
        domain={report.domain}
        rows={report.competitors}
      />

      <ExplorerPreviewModal
        open={preview !== null}
        onClose={() => {
          setPreview(null);
        }}
        kind={preview ?? "keywords"}
        domain={report.domain}
        keywords={report.organicPreview}
        competitors={report.referringPreview}
        backlinks={report.backlinks}
        dofollow={report.dofollow}
        nofollow={report.nofollow}
        referringDomains={report.referringDomains}
        citingPages={report.citingPages}
      />
    </>
  );
}

export function ExplorerLoading() {
  return (
    <div className="flex min-h-[40svh] items-center justify-center rounded-lg border border-border bg-card">
      <EqualizerLoader label="Analysing domain" size="lg" />
    </div>
  );
}
