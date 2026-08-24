"use client";

import { ExternalLink, Globe, Info, PlugZap, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import {
  PositionChart,
  TrafficChart,
} from "@/components/competitors/overview-charts";
import { ScorePill } from "@/components/difficulty";
import { Badge } from "@/components/ui/badge";
import type { ExplorerReport } from "@/lib/competitors";
import {
  RANGE_LABEL,
  OVERVIEW_RANGES,
  OVERVIEW_TABS,
  type DomainOverview,
  type OverviewRange,
  type OverviewTab,
} from "@/lib/domain-overview";
import { formatCpc, formatNumber, formatVolume } from "@/lib/keywords/format";
import { cn } from "@/lib/utils";

/**
 * Domain overview: one dashboard, two tiers of data.
 *
 * Link and keyword figures work for any domain, because they are derived from
 * sources that see the whole web. Traffic, countries, page-level traffic and
 * ranking history only exist for a property you own in Search Console. Rather
 * than estimating the second group for competitors, the panels stay empty and
 * say which of the two you are looking at — the numbers a paid tool shows here
 * come from a clickstream index this app deliberately does not buy.
 */

/*
 * Tabs come from `lib/domain-overview` rather than being declared here: the
 * server component needs `parseTab` too, and a "use client" module cannot
 * export a function the server calls.
 */
const TABS = OVERVIEW_TABS;

type TabId = OverviewTab;

/* -------------------------------------------------------------------------- */
/* Shell                                                                       */
/* -------------------------------------------------------------------------- */

function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      {title !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className="min-w-0 flex-1 px-4 pb-4">{children}</div>
    </section>
  );
}

function Favicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/12 text-[11px] font-bold uppercase text-primary"
        aria-hidden
      >
        {domain.slice(0, 1)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party icon, not an optimisable asset
    <img
      src={`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`}
      alt=""
      width={24}
      height={24}
      className="size-6 shrink-0 rounded"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

/** Range and tab both live in the URL, so any view is shareable. */
function useNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  return { set, pending };
}

function StatTile({
  label,
  value,
  hint,
  unavailable = false,
}: {
  label: string;
  value: string;
  hint?: string;
  unavailable?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-2xl font-bold",
          unavailable && "text-muted-foreground/70",
        )}
      >
        {value}
      </p>
      {hint !== undefined && (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Why a measured panel is empty, and what to do about it.
 *
 * Every branch names the actual blocker rather than showing a generic "no
 * data" — the fix is different in each case, and only one of them is even
 * possible for the domain on screen.
 */
function GapNotice({ overview }: { overview: DomainOverview }) {
  if (overview.gap === null) return null;

  const body = {
    NOT_YOUR_SITE: {
      icon: Globe,
      title: "Traffic data is only available for your own sites",
      text: "Search Console reports on properties you own. Nothing free measures another domain's traffic, countries or ranking history — paid tools estimate it from a clickstream panel, which this app does not buy. Link strength, keywords and authority above are still real for this domain.",
      cta: null,
    },
    NOT_CONNECTED: {
      icon: PlugZap,
      title: "Connect Search Console to fill these panels",
      text: "This is your project, but no Search Console property is linked to it yet. Linking one turns on real traffic, country and ranking-position history — measured, not estimated.",
      cta: { href: "/projects", label: "Link a property" },
    },
    NOT_SYNCED: {
      icon: RefreshCw,
      title: "No Search Console data imported yet",
      text: "The property is linked but nothing has been pulled in for this range. Run a sync from the project, then come back.",
      cta: { href: "/projects", label: "Open project settings" },
    },
  }[overview.gap];

  const Icon = body.icon;

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5">
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{body.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{body.text}</p>
          {body.cta && (
            <Link
              href={body.cta.href}
              className="mt-2 inline-block text-sm font-semibold text-primary hover:underline"
            >
              {body.cta.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panels                                                                      */
/* -------------------------------------------------------------------------- */

function CountryTable({ overview }: { overview: DomainOverview }) {
  const [page, setPage] = useState(0);
  const perPage = 5;
  const pages = Math.max(1, Math.ceil(overview.countries.length / perPage));
  const rows = overview.countries.slice(page * perPage, page * perPage + perPage);

  if (overview.countries.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {overview.gap === null
          ? "No country breakdown in this range."
          : "Available once Search Console is connected."}
      </p>
    );
  }

  return (
    <div>
      <table className="w-full text-sm">
        <caption className="sr-only">Clicks by country</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-2 font-medium">
              Country
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Traffic
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Share
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Keywords
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.code} className="border-t border-border/70">
              <td className="py-2">
                <span className="block truncate">{c.label}</span>
                <span
                  className="mt-1 block h-1 rounded-full bg-primary"
                  style={{ width: `${String(Math.max(2, c.share))}%` }}
                  aria-hidden
                />
              </td>
              <td className="tabular py-2 text-right align-top">
                {formatNumber(c.clicks)}
              </td>
              <td className="tabular py-2 text-right align-top">
                {c.share.toFixed(1)}%
              </td>
              <td className="tabular py-2 text-right align-top">
                {c.keywords === null ? "—" : formatNumber(c.keywords)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Traffic and share follow the selected range.
          {overview.countryKeywordDays !== null &&
            ` Keyword counts cover the last ${String(overview.countryKeywordDays)} days.`}
        </p>
        {pages > 1 && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => {
                setPage((p) => Math.max(0, p - 1));
              }}
              disabled={page === 0}
              aria-label="Previous countries"
              className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                setPage((p) => Math.min(pages - 1, p + 1));
              }}
              disabled={page >= pages - 1}
              aria-label="More countries"
              className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TopPagesTable({
  overview,
  report,
  limit,
}: {
  overview: DomainOverview;
  report: ExplorerReport;
  limit: number;
}) {
  // Measured pages when we have Search Console; otherwise what the crawler saw.
  if (overview.topPages.length > 0) {
    return (
      <table className="w-full text-sm">
        <caption className="sr-only">Pages by clicks</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-2 font-medium">
              Title &amp; URL
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Traffic
            </th>
          </tr>
        </thead>
        <tbody>
          {overview.topPages.slice(0, limit).map((p) => (
            <tr key={p.url} className="border-t border-border/70">
              <td className="max-w-0 py-2">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium hover:text-primary hover:underline"
                >
                  {p.path === "/" ? "Home" : p.path}
                </a>
                <span className="block truncate text-xs text-primary/80">
                  {p.url}
                </span>
              </td>
              <td className="tabular py-2 pl-3 text-right align-top">
                {formatNumber(p.clicks)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (report.crawledPages.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No pages could be read from this domain.
      </p>
    );
  }

  return (
    <>
      <table className="w-full text-sm">
        <caption className="sr-only">Pages found by the crawler</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-2 font-medium">
              Title &amp; URL
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Internal links
            </th>
          </tr>
        </thead>
        <tbody>
          {report.crawledPages.slice(0, limit).map((p) => (
            <tr key={p.url} className="border-t border-border/70">
              <td className="max-w-0 py-2">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium hover:text-primary hover:underline"
                >
                  {p.title || p.path}
                </a>
                <span className="block truncate text-xs text-primary/80">
                  {p.url}
                </span>
              </td>
              <td className="tabular py-2 pl-3 text-right align-top">
                {formatNumber(p.inboundLinks)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 flex gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          Ranked by how many of the site&apos;s own pages link to each one — a
          real signal of what it considers important. Per-page traffic needs
          Search Console access to this domain.
        </span>
      </p>
    </>
  );
}

function KeywordTable({
  report,
  limit,
}: {
  report: ExplorerReport;
  limit: number;
}) {
  if (report.organicPreview.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No keywords found for this domain.
      </p>
    );
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-136 text-sm">
        <caption className="sr-only">Keywords this domain competes on</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-2 font-medium">
              Keyword
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Position
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Volume
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Traffic
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              CPC
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              KD
            </th>
          </tr>
        </thead>
        <tbody>
          {report.organicPreview.slice(0, limit).map((k) => (
            <tr key={k.keyword} className="border-t border-border/70">
              <td className="max-w-0 py-2">
                <Link
                  href={`/keywords?q=${encodeURIComponent(k.keyword)}`}
                  className="block truncate font-medium hover:text-primary hover:underline"
                >
                  {k.keyword}
                </Link>
              </td>
              <td className="tabular py-2 pl-3 text-right">
                {k.position === null ? "—" : k.position.toFixed(1)}
              </td>
              <td className="tabular py-2 pl-3 text-right">
                {formatVolume(k.volume)}
              </td>
              <td className="tabular py-2 pl-3 text-right">
                {k.estTraffic === null ? "—" : formatNumber(k.estTraffic)}
              </td>
              <td className="tabular py-2 pl-3 text-right">{formatCpc(k.cpc)}</td>
              <td className="py-2 pl-3 text-right">
                <ScorePill score={k.difficulty} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompetitorsPanel({ report }: { report: ExplorerReport }) {
  return (
    <div className="grid min-w-0 gap-3 *:min-w-0 lg:grid-cols-2">
      <Card
        title="Domains sharing these SERPs"
        action={<Badge variant="success">Measured · cached results</Badge>}
      >
        {report.competitors.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No rivals seen yet. Research a few of this domain&apos;s keywords
            and they will appear here.
          </p>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-104 text-sm">
              <caption className="sr-only">
                Domains appearing alongside this one in search results
              </caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-2 font-medium">
                    Domain
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Strength
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Ref. domains
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Shared keywords
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.competitors.map((c) => (
                  <tr key={c.site} className="border-t border-border/70">
                    <td className="max-w-0 py-2">
                      <Link
                        href={`/competitors?domain=${encodeURIComponent(c.site)}`}
                        className="block truncate font-medium hover:text-primary hover:underline"
                      >
                        {c.site}
                      </Link>
                    </td>
                    <td className="tabular py-2 pl-3 text-right">
                      {c.ds === null ? "—" : c.ds.toFixed(1)}
                    </td>
                    <td className="tabular py-2 pl-3 text-right">
                      {c.domains === null ? "—" : `~${formatNumber(c.domains)}`}
                    </td>
                    <td className="tabular py-2 pl-3 text-right">
                      {formatNumber(c.keywords)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 flex gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Counted from search results already fetched for this project — no
            extra API spend. Coverage grows as more keywords are researched.
          </span>
        </p>
      </Card>

      <Card
        title="Top linking domains"
        action={
          report.linkDataRelease === null ? (
            <Badge variant="secondary">Not looked up</Badge>
          ) : (
            <Badge variant="secondary">
              Common Crawl {report.linkDataRelease}
            </Badge>
          )
        }
      >
        {report.topLinkingDomains.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No link-graph data for this domain.
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Domains linking to this one</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="pb-2 font-medium">
                  Domain
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Hosts
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Authority
                </th>
              </tr>
            </thead>
            <tbody>
              {report.topLinkingDomains.slice(0, 15).map((d) => (
                <tr key={d.domain} className="border-t border-border/70">
                  <td className="max-w-0 truncate py-2">{d.domain}</td>
                  <td className="tabular py-2 pl-3 text-right">
                    {formatNumber(d.hosts)}
                  </td>
                  <td className="tabular py-2 pl-3 text-right">
                    {d.authority === null ? "—" : String(d.authority)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

export function DomainOverviewView({
  report,
  overview,
  tab,
}: {
  report: ExplorerReport;
  overview: DomainOverview;
  tab: TabId;
}) {
  const { set, pending } = useNav();

  const measured = overview.gap === null;

  return (
    <div className={cn("space-y-4", pending && "opacity-70 transition-opacity")}>
      {/* ---------- Header ---------- */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <Favicon domain={report.domain} />
            <h2 className="truncate text-lg font-bold tracking-tight">
              {report.domain}
            </h2>
            <a
              href={`https://${report.domain}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${report.domain} in a new tab`}
              className="text-muted-foreground hover:text-primary"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>

          <div
            role="group"
            aria-label="Date range"
            className="flex shrink-0 overflow-hidden rounded-md border border-border"
          >
            {OVERVIEW_RANGES.map((r: OverviewRange) => (
              <button
                key={r}
                type="button"
                aria-pressed={overview.range === r}
                onClick={() => {
                  set("range", r);
                }}
                className={cn(
                  "px-2.5 py-1.5 text-xs font-medium transition-colors",
                  overview.range === r
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        <nav aria-label="Domain views" className="scroll-x mt-2 flex gap-1 px-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => {
                set("tab", t.id);
              }}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
                tab === t.id
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ---------- Stat tiles ---------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Page Score"
          value={
            report.domainStrength === null
              ? "N/A"
              : String(Math.round(report.domainStrength * 10))
          }
          hint="Snaily DA · derived"
        />
        <StatTile
          label="Estimated Traffic"
          value={
            measured
              ? formatNumber(overview.totalClicks)
              : "Not available"
          }
          hint={
            measured
              ? `clicks · ${RANGE_LABEL[overview.range]}`
              : "needs Search Console"
          }
          unavailable={!measured}
        />
        <StatTile
          label="Backlinks"
          value={
            report.backlinks === null ? "N/A" : `~${formatNumber(report.backlinks)}`
          }
          hint="estimated from PageRank"
        />
        <StatTile
          label="Referring Domains"
          value={
            report.referringDomains === null
              ? "N/A"
              : `~${formatNumber(report.referringDomains)}`
          }
          hint={
            report.linkDataRelease === null
              ? "estimated"
              : `Common Crawl ${report.linkDataRelease}`
          }
        />
        <StatTile
          label="Keywords"
          value={formatNumber(report.organicCount)}
          hint={
            report.organicSource === "search-console"
              ? "measured · Search Console"
              : "targeted · from the site's pages"
          }
        />
      </div>

      {/* ---------- Tab panels ---------- */}
      {tab === "overview" && (
        <>
          <GapNotice overview={overview} />

          <div className="grid min-w-0 gap-3 *:min-w-0 lg:grid-cols-2">
            <Card
              title="Traffic"
              action={
                measured ? (
                  <Badge variant="success">Measured · Search Console</Badge>
                ) : (
                  <Badge variant="secondary">Unavailable</Badge>
                )
              }
            >
              <TrafficChart points={overview.traffic} />
            </Card>

            <Card
              title="Traffic by Country"
              action={
                measured ? (
                  <Badge variant="success">Measured</Badge>
                ) : (
                  <Badge variant="secondary">Unavailable</Badge>
                )
              }
            >
              <CountryTable overview={overview} />
            </Card>

            <Card
              title="Top Pages"
              action={
                <button
                  type="button"
                  onClick={() => {
                    set("tab", "pages");
                  }}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                >
                  See All
                </button>
              }
            >
              <TopPagesTable overview={overview} report={report} limit={5} />
            </Card>

            <Card
              title="Keywords by Position"
              action={
                measured ? (
                  <Badge variant="success">Measured</Badge>
                ) : (
                  <Badge variant="secondary">Unavailable</Badge>
                )
              }
            >
              <PositionChart points={overview.positions} />
            </Card>
          </div>
        </>
      )}

      {tab === "pages" && (
        <Card title="Top Pages">
          <TopPagesTable overview={overview} report={report} limit={25} />
        </Card>
      )}

      {tab === "keywords" && (
        <Card
          title="Top Keywords"
          action={
            <Badge
              variant={
                report.organicSource === "search-console" ? "success" : "secondary"
              }
            >
              {report.organicSource === "search-console"
                ? "Measured · Search Console"
                : "Targeted · read from the site's pages"}
            </Badge>
          }
        >
          <KeywordTable report={report} limit={25} />
        </Card>
      )}

      {tab === "competitors" && <CompetitorsPanel report={report} />}
    </div>
  );
}
