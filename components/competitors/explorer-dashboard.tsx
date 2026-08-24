"use client";

import { ArrowDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CompetitorsModal } from "@/components/competitors/competitors-modal";
import { CardAction } from "@/components/competitors/card-action";
import { DomainGauge } from "@/components/competitors/domain-gauge";
import {
  ExplorerPreviewModal,
  type PreviewKind,
} from "@/components/competitors/explorer-preview-modal";
import { OverviewChart } from "@/components/competitors/overview-chart";
import { ScorePill } from "@/components/difficulty";
import type { ExplorerReport } from "@/lib/competitors";
import type { DomainOverview } from "@/lib/domain-overview";
import { formatCpc, formatNumber, formatVolume } from "@/lib/keywords/format";
import { cn } from "@/lib/utils";

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

export function ExplorerDashboard({
  report,
  overview,
}: {
  report: ExplorerReport;
  /**
   * Measured Search Console traffic, when the searched domain is one of the
   * user's own connected properties. The Traffic Overview tab used to plot
   * the backlink series times 0.22, which was a made-up number wearing a
   * chart; this is the real one or nothing.
   */
  overview: DomainOverview;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewKind | null>(null);
  const [chartTab, setChartTab] = useState<"backlinks" | "traffic">(
    "backlinks",
  );

  const maxDist = Math.max(
    1,
    ...report.rankingDistribution.map((b) => b.count),
  );

  const traffic = overview.traffic;
  const trafficNote =
    overview.gap === null
      ? `Measured clicks per day from Search Console — ${formatNumber(
          overview.totalClicks,
        )} in the last 30 days.`
      : overview.gap === "NOT_YOUR_SITE"
        ? "Traffic is only measurable for a site you own in Search Console. Nothing free reports another domain's traffic."
        : overview.gap === "NOT_CONNECTED"
          ? "This is your project, but no Search Console property is linked to it yet."
          : "Search Console is linked but no data has been imported yet. Run a sync from the project.";

  const tipTarget = report.targetCompetition;
  const scorePct = Math.min(100, (report.competitionScore / 100) * 100);

  return (
    <>
      {/* The four headline cards, one full-width row. */}
      <div className="mb-3 grid min-w-0 gap-3 *:min-w-0 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <DomainGauge value={report.domainStrength} domain={report.domain} />
        </Card>

        <Card className="flex flex-col justify-center p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold">Score To Target</h3>
            <p className="text-[11px] text-muted-foreground">
              Competition Level
            </p>
          </div>
          <div className="mt-2 flex items-start justify-between gap-2">
            <p className="flex items-center gap-1 text-3xl font-bold text-success">
              {report.competitionScore}
              <ArrowDown className="size-4" aria-hidden />
            </p>
            <p className="text-[11px] font-semibold text-foreground">
              Target Competition
            </p>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-success">
              {report.competitionLabel}
            </p>
            <p className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-bold text-success">
              {report.competitionScore}
            </p>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success transition-all"
              style={{ width: `${String(scorePct)}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Try to target competition of {tipTarget} or less
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold">Backlinks</h3>
            <CardAction
              onClick={() => {
                setPreview("backlinks");
              }}
            >
              View Backlinks
            </CardAction>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="tabular text-3xl font-bold">
              {report.backlinks === null
                ? "N/A"
                : `~${formatNumber(report.backlinks)}`}
            </p>
            <p className="text-[11px] text-muted-foreground">Total Backlinks</p>
          </div>
          <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <dt>Dofollow</dt>
              <dd
                className="tabular font-semibold"
                title="Nothing free reports rel attributes. This was a flat 73% of the backlink estimate — a guess shown as a measurement."
              >
                N/A
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Nofollow</dt>
              <dd
                className="tabular font-semibold"
                title="Nothing free reports rel attributes."
              >
                N/A
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Estimated from the Common Crawl link graph · {report.citingPages}{" "}
            live citing pages. The dofollow split needs a backlink index.
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold">Referring Domains</h3>
            <CardAction
              onClick={() => {
                setPreview("domains");
              }}
            >
              View Domains
            </CardAction>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="tabular text-3xl font-bold">
              {report.referringDomains === null
                ? "N/A"
                : `~${formatNumber(report.referringDomains)}`}
            </p>
            <p className="text-[11px] text-muted-foreground">Total Domains</p>
          </div>
          <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <dt>Global Rank</dt>
              <dd className="tabular font-semibold text-foreground">
                {report.globalRank === null
                  ? "N/A"
                  : formatNumber(report.globalRank)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Domain Strength</dt>
              <dd className="tabular font-semibold text-foreground">
                {report.domainStrength === null
                  ? "N/A"
                  : report.domainStrength.toFixed(1)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid min-w-0 gap-3 *:min-w-0 lg:grid-cols-2">
        {/* ================= LEFT ================= */}
        <div className="space-y-3">
          {/* Organic Keywords */}
          <Card>
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold">Organic Keywords</h3>
                <p className="text-[11px] text-muted-foreground">
                  Top Keywords By Position
                </p>
              </div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <p className="tabular text-3xl font-bold">
                  {formatNumber(report.organicCount)}
                </p>
                <div className="text-right">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {report.organicSource === "search-console"
                      ? "Measured · GSC"
                      : "Targeted · crawl"}
                  </span>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Estimated Traffic:{" "}
                    <span className="tabular font-semibold text-foreground">
                      {formatNumber(report.estimatedTraffic)}
                    </span>
                  </p>
                </div>
              </div>
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
                    <th className="px-3 py-2 text-right font-semibold">
                      Score
                    </th>
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
              <p className="text-[11px] text-muted-foreground">
                Found in SERPS
              </p>
            </div>
            <div className="min-w-0 flex-1 overflow-x-auto">
              <table className="w-full min-w-[20rem] text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Site</th>
                    <th className="px-2 py-2 text-right font-semibold">DS</th>
                    <th className="px-2 py-2 text-right font-semibold">
                      Links
                    </th>
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
                        {c.ds === null ? "—" : c.ds.toFixed(1)}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {c.links === null ? "—" : `~${formatNumber(c.links)}`}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {c.domains === null
                          ? "—"
                          : `~${formatNumber(c.domains)}`}
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
              {chartTab === "backlinks" ? (
                <>
                  {/*
                    Backlink history needs a link index that stores a snapshot
                    per crawl. The Common Crawl graph gives one figure for the
                    current release, so there is no series to plot — and a
                    synthesised curve is indistinguishable from a real one,
                    which makes it the most misleading thing to draw here.
                  */}
                  <OverviewChart values={report.trend} />
                  {report.trend.length === 1 && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      First reading recorded today. A point is added each day
                      this domain is analysed, so the curve fills in from here.
                    </p>
                  )}
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Backlink history needs a backlink index. Today&apos;s figure
                    is{" "}
                    {report.backlinks === null
                      ? "unavailable"
                      : `~${formatNumber(report.backlinks)} links across ~${
                          report.referringDomains === null
                            ? "?"
                            : formatNumber(report.referringDomains)
                        } domains`}
                    , estimated from the Common Crawl link graph.
                  </p>
                </>
              ) : (
                <>
                  <OverviewChart values={traffic.map((t) => t.clicks)} />
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {trafficNote}
                  </p>
                </>
              )}
            </div>
          </Card>

          <Card>
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-bold">Top DS Referring Domains</h3>
              <p className="text-[11px] text-muted-foreground">
                Top Linking Domains By DS
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Site</th>
                    <th className="px-2 py-2 text-right font-semibold">
                      Authority
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Links
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.topLinkingDomains.map((d) => (
                    <tr
                      key={`ref-${d.domain}`}
                      className="border-b border-border/60"
                    >
                      <td className="px-3 py-2">
                        <a
                          href={`https://${d.domain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          {d.domain}
                        </a>
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {d.authority === null ? "—" : String(d.authority)}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {formatNumber(d.hosts)}
                      </td>
                    </tr>
                  ))}
                  {report.topLinkingDomains.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        No citing pages could be read for this domain.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {report.topLinkingDomains.length > 0 && (
              <CardFooter>
                <CardAction
                  href={`/backlinks?domain=${encodeURIComponent(report.domain)}`}
                >
                  View More
                </CardAction>
              </CardFooter>
            )}
          </Card>

          {/*
            Anchor text read from the citing pages themselves, rather than from
            a backlink index. Google names pages that reference the domain; a
            page's outbound anchors are readable by anyone who fetches it. Real
            words from real pages — across the sample Google returned, which is
            what the footnote says.
          */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="text-sm font-bold">Top Anchors</h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  report.topAnchors.length > 0
                    ? "bg-success/15 text-success"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {report.topAnchors.length > 0 ? "Measured" : "None found"}
              </span>
            </div>
            {report.topAnchors.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                No anchor text found. Either no citing page could be fetched, or
                the ones that were mention this domain without linking to it.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-border/60">
                  {report.topAnchors.map((a) => {
                    const total = report.topAnchors.reduce(
                      (sum, x) => sum + x.count,
                      0,
                    );
                    const pct = total === 0 ? 0 : (a.count / total) * 100;
                    return (
                      <li key={a.text} className="px-4 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className="min-w-0 truncate text-[12px]"
                            title={a.text}
                          >
                            {a.text}
                          </span>
                          <span className="tabular shrink-0 text-[11px] text-muted-foreground">
                            {a.count} · {pct.toFixed(0)}%
                          </span>
                        </div>
                        <span
                          className="mt-1 block h-1 rounded-full bg-primary"
                          style={{ width: `${String(Math.max(2, pct))}%` }}
                          aria-hidden
                        />
                      </li>
                    );
                  })}
                </ul>
                <p className="px-4 pb-3 pt-2 text-[10px] text-muted-foreground">
                  Read from {report.citationsRead} citing page
                  {report.citationsRead === 1 ? "" : "s"} that Google returned —
                  a real sample of the link profile, not all of it.
                </p>
              </>
            )}
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

        referringDomains={report.referringDomains}
        citingPages={report.citingPages}
      />
    </>
  );
}
