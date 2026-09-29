import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileEdit,
  FileSearch,
  Gauge,
  Lightbulb,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { SetupProgressCard } from "@/components/setup/setup-progress-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { alertCopy, type RankAlertRow } from "@/lib/alerts-logic";
import type {
  DailyClicks,
  ProjectOverview,
  RankBucket,
  RecentActivityItem,
  StatusCount,
} from "@/lib/dashboard/stats";
import { formatNumber } from "@/lib/keywords/format";

/* ---------------------------------------------------------------------------
 * Traffic Sparkline — tiny inline SVG beside the 28-day clicks KPI.
 * Follows the same Catmull-Rom approach as TrendChart but stripped to a
 * thumbnail-sized sparkline with no axes or labels.
 * ------------------------------------------------------------------------- */

function smoothSparklinePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2 < points.length ? i + 2 : points.length - 1]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function TrafficSparkline({ data }: { data: DailyClicks[] }) {
  if (data.length < 2) {
    return (
      <span className="text-[10px] text-muted-foreground">No daily data</span>
    );
  }
  const w = 120;
  const h = 32;
  const pad = 2;
  const max = Math.max(...data.map((d) => d.clicks), 1);

  const points = data.map((d, i) => ({
    x: pad + (i / (data.length - 1)) * (w - pad * 2),
    y: pad + (1 - d.clicks / max) * (h - pad * 2),
  }));

  const line = smoothSparklinePath(points);
  const area = `${line} L ${points[points.length - 1]!.x.toFixed(1)} ${(h - pad).toFixed(1)} L ${points[0]!.x.toFixed(1)} ${(h - pad).toFixed(1)} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-8 w-[120px]"
      role="img"
      aria-label="Daily clicks over the last 28 days"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" className="chart-area" />
      <path
        d={line}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="chart-line"
      />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * Ranking Distribution — horizontal bar chart with position buckets.
 * Same style as the OverviewChart: hand-rolled SVG, no library.
 * ------------------------------------------------------------------------- */

const RANK_COLORS = [
  "var(--success)",           // 1–3
  "var(--primary)",           // 4–10
  "var(--chart-2)",           // 11–20
  "var(--warning)",           // 21–50
  "var(--muted-foreground)",  // 50+
];

function RankDistributionChart({ buckets }: { buckets: RankBucket[] }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        No ranking data yet. Add keywords to the rank tracker to see the
        distribution.
      </p>
    );
  }

  const max = Math.max(...buckets.map((b) => b.count), 1);
  const barH = 20;
  const gap = 8;
  const labelW = 36;
  const countW = 30;
  const padR = 4;
  const chartW = 260;
  const barArea = chartW - labelW - countW - padR;
  const h = buckets.length * (barH + gap) - gap + 8;

  return (
    <svg
      viewBox={`0 0 ${chartW} ${h}`}
      className="w-full"
      role="img"
      aria-label="Ranking distribution across position buckets"
    >
      {buckets.map((b, i) => {
        const y = i * (barH + gap) + 4;
        const bw = Math.max(2, (b.count / max) * (barArea - 4));
        return (
          <g key={b.label}>
            <text
              x={labelW - 4}
              y={y + barH / 2 + 4}
              textAnchor="end"
              className="fill-muted-foreground"
              style={{ fontSize: 11 }}
            >
              {b.label}
            </text>
            <rect
              x={labelW}
              y={y}
              width={bw}
              height={barH}
              rx={4}
              fill={RANK_COLORS[i % RANK_COLORS.length]}
              fillOpacity={0.85}
              className="chart-area"
            />
            <text
              x={labelW + bw + 6}
              y={y + barH / 2 + 4}
              className="fill-foreground"
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              {b.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * Recent Activity Feed — last 5 actions with icon + timestamp.
 * ------------------------------------------------------------------------- */

const ACTIVITY_ICON = {
  search: Search,
  article: FileEdit,
  audit: Gauge,
} as const;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function RecentActivityFeed({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        No recent activity yet. Start researching keywords, creating articles,
        or running audits.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item, i) => {
        const Icon = ACTIVITY_ICON[item.type];
        return (
          <li
            key={`${item.type}-${i}`}
            className="flex items-start gap-2 text-sm"
          >
            <Icon
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {timeAgo(item.date)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------------------
 * Content Health Donut — articles by status, matching the AnchorsDonut style.
 * Uses the .ring-segment animation class from globals.css.
 * ------------------------------------------------------------------------- */

const STATUS_COLORS: Record<string, string> = {
  preparing: "var(--chart-muted)",
  draft: "var(--warning)",
  in_progress: "var(--chart-2)",
  published: "var(--success)",
};

const STATUS_LABELS: Record<string, string> = {
  preparing: "Preparing",
  draft: "Draft",
  in_progress: "In progress",
  published: "Published",
};

function ContentHealthDonut({ statuses }: { statuses: StatusCount[] }) {
  const total = statuses.reduce((s, b) => s + b.count, 0);
  if (total === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        No articles yet. Create one in the Content Assistant.
      </p>
    );
  }

  const R = 42;
  const CX = 56;
  const CY = 56;
  const stroke = 16;
  const C = 2 * Math.PI * R;

  let offset = 0;
  const slices = statuses
    .filter((s) => s.count > 0)
    .map((s) => {
      const frac = s.count / total;
      const len = frac * C;
      const slice = {
        status: s.status,
        label: STATUS_LABELS[s.status] ?? s.status,
        color: STATUS_COLORS[s.status] ?? "var(--muted-foreground)",
        dash: `${len.toFixed(2)} ${(C - len).toFixed(2)}`,
        offset: -offset,
        count: s.count,
        pct: Math.round(frac * 100),
      };
      offset += len;
      return slice;
    });

  return (
    <div className="flex items-center gap-4">
      <svg
        viewBox="0 0 112 112"
        className="size-28 shrink-0"
        role="img"
        aria-label="Articles by status"
      >
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted"
        />
        {slices.map((s) => (
          <circle
            key={s.status}
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={s.dash}
            strokeDashoffset={s.offset}
            transform={`rotate(-90 ${CX} ${CY})`}
            className="ring-segment"
          />
        ))}
        <text
          x={CX}
          y={CY + 1}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground"
          style={{ fontSize: 18, fontWeight: 700 }}
        >
          {total}
        </text>
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s) => (
          <li
            key={s.status}
            className="flex items-center gap-2 text-[12px]"
          >
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: s.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {s.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const QUICK_LINKS = [
  {
    href: "/keywords",
    title: "Keyword research",
    body: "Volume, difficulty, and SERP analysis.",
    icon: Search,
  },
  {
    href: "/audit",
    title: "Site audit",
    body: "Crawl for on-page SEO issues.",
    icon: Gauge,
  },
  {
    href: "/on-page",
    title: "On-Page SEO",
    body: "Analyze URLs, snippets, and technical setup.",
    icon: FileSearch,
  },
  {
    href: "/content",
    title: "Content Intelligence",
    body: "Prioritize fixes from your last audit.",
    icon: Lightbulb,
  },
  {
    href: "/tracking",
    title: "Rank tracker",
    body: "Watch positions over time.",
    icon: Activity,
  },
] as const;

function SetupItem({
  done,
  label,
  href,
}: {
  done: boolean;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
    >
      {done ? (
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
      ) : (
        <span className="size-4 shrink-0 rounded-full border border-border" aria-hidden />
      )}
      <span className={done ? "text-muted-foreground" : "font-medium"}>{label}</span>
    </Link>
  );
}

export function DashboardOverview({
  project,
  overview,
  firstName,
  alerts = [],
  errors = [],
}: {
  project: { id: string; name: string; url: string };
  overview: ProjectOverview;
  firstName: string;
  alerts?: RankAlertRow[];
  errors?: { id: string; message: string; route: string; requestId: string; createdAt: Date }[];
}) {
  const setupDone = Object.values(overview.setup).filter(Boolean).length;
  const setupTotal = Object.keys(overview.setup).length;
  const auditDate =
    overview.lastAudit !== null
      ? new Date(overview.lastAudit.finishedAt).toLocaleDateString()
      : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Overview for {project.name}
        </p>
      </div>

      {alerts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" aria-hidden />
              Rank movement
            </CardTitle>
            <CardDescription>
              Live SERP checks — drops of 5+ places, losses, and notable gains.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3">
                  <span>{alertCopy(a)}</span>
                  <Link
                    href="/tracking"
                    className="shrink-0 text-xs text-primary hover:underline"
                  >
                    Tracker
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {errors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent failures</CardTitle>
            <CardDescription>
              Owner log — no request bodies or secrets. Correlate with the
              request id in Vercel logs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {errors.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3"
                >
                  <span>
                    {e.message}
                    {e.route ? (
                      <span className="text-muted-foreground"> · {e.route}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {e.requestId ? `id ${e.requestId.slice(0, 8)} · ` : ""}
                    {e.createdAt.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{project.name}</CardTitle>
          <CardDescription>
            <a
              href={project.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              {project.url.replace(/^https?:\/\//, "")}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={`/projects/${project.id}`}>Project settings</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/integrations">Integrations</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/audit">Run audit</Link>
          </Button>
          <Button asChild>
            <Link href="/keywords">Research keywords</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Site health</CardDescription>
            <CardTitle className="tabular text-2xl">
              {overview.lastAudit !== null
                ? `${String(overview.lastAudit.healthScore)}`
                : "No audit"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {overview.lastAudit !== null ? (
              <>
                {overview.lastAudit.totalIssues} issues · {auditDate}
              </>
            ) : (
              "No completed audit yet"
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-end justify-between gap-2">
              <div>
                <CardDescription>Search Console (28d)</CardDescription>
                <CardTitle className="tabular text-2xl">
                  {overview.searchConsole !== null
                    ? formatNumber(overview.searchConsole.clicks)
                    : "0"}
                </CardTitle>
              </div>
              {overview.dailyClicks.length >= 2 && (
                <TrafficSparkline data={overview.dailyClicks} />
              )}
            </div>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {overview.searchConsole !== null ? (
              <>
                {formatNumber(overview.searchConsole.impressions)} impressions ·
                pos {overview.searchConsole.avgPosition}
              </>
            ) : (
              "Connect Google in Integrations"
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Tracked keywords</CardDescription>
            <CardTitle className="tabular text-2xl">
              {formatNumber(overview.trackedKeywords)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link href="/tracking" className="hover:text-foreground hover:underline">
              Open rank tracker
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Content</CardDescription>
            <CardTitle className="tabular text-2xl">
              {formatNumber(overview.articles)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {overview.keywordLists} keyword lists ·{" "}
            <Link href="/geo-lab" className="hover:text-foreground hover:underline">
              GEO Lab
            </Link>
          </CardContent>
        </Card>
      </div>

      <SetupProgressCard />

      {setupDone < setupTotal && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Get set up</CardTitle>
              <Badge variant="secondary">
                {setupDone}/{setupTotal}
              </Badge>
            </div>
            <CardDescription>
              Complete these once per project so every tool has data to work with.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <SetupItem
              done={overview.setup.hasGoogle}
              label="Connect Search Console"
              href="/integrations"
            />
            <SetupItem
              done={overview.setup.hasAudit}
              label="Run your first site audit"
              href="/audit"
            />
            <SetupItem
              done={overview.setup.hasTracking}
              label="Add keywords to rank tracker"
              href="/tracking"
            />
            <SetupItem
              done={overview.setup.hasBusinessFacts}
              label="Fill in GEO Lab business facts"
              href="/geo-lab"
            />
          </CardContent>
        </Card>
      )}

      {/* ---- Visual insight panels ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Ranking distribution */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ranking distribution</CardTitle>
            <CardDescription>
              Tracked keywords by position bucket
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RankDistributionChart buckets={overview.rankDistribution} />
          </CardContent>
        </Card>

        {/* Content health donut */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Content health</CardTitle>
            <CardDescription>Articles by status</CardDescription>
          </CardHeader>
          <CardContent>
            <ContentHealthDonut statuses={overview.articlesByStatus} />
          </CardContent>
        </Card>

        {/* Recent activity feed */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle className="text-base">Recent activity</CardTitle>
            </div>
            <CardDescription>Last 5 actions across the project</CardDescription>
          </CardHeader>
          <CardContent>
            <RecentActivityFeed items={overview.recentActivity} />
          </CardContent>
        </Card>
      </div>

      {overview.lastAudit !== null && overview.lastAudit.totalIssues > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            Your last audit found{" "}
            <strong>{formatNumber(overview.lastAudit.totalIssues)} issues</strong> across{" "}
            {formatNumber(overview.lastAudit.pagesCrawled)} pages.{" "}
            <Link href="/content" className="font-medium text-primary hover:underline">
              See what to fix first
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_LINKS.map(({ href, title, body, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon
              className="mb-2 size-5 text-muted-foreground group-hover:text-primary"
              aria-hidden
            />
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DashboardEmpty({ firstName }: { firstName: string }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Add your first project to unlock research, audits, and tracking.
        </p>
      </div>
      <EmptyState
        title="No projects yet"
        description="A project is one website you want to analyze. Add one to unlock keyword research, site audits, rank tracking, and Content Intelligence."
        action={{ href: "/projects", label: "Add a project" }}
      />
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" aria-hidden />
          What you get with a project
        </div>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>· Keyword research with live SERP data (when SerpApi is connected)</li>
          <li>· Site audits that crawl your pages and flag SEO issues</li>
          <li>· Search Console performance when Google is connected</li>
          <li>· Rank tracking and content prioritization from real crawl data</li>
        </ul>
      </div>
    </div>
  );
}
