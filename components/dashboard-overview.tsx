import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Gauge,
  Lightbulb,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ProjectOverview } from "@/lib/dashboard/stats";
import { formatNumber } from "@/lib/keywords/format";

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
}: {
  project: { id: string; name: string; url: string };
  overview: ProjectOverview;
  firstName: string;
}) {
  const setupDone = Object.values(overview.setup).filter(Boolean).length;
  const setupTotal = Object.keys(overview.setup).length;
  const auditDate =
    overview.lastAudit !== null
      ? new Date(overview.lastAudit.finishedAt).toLocaleDateString()
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Overview for {project.name}
        </p>
      </div>

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
                : "—"}
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
            <CardDescription>Search Console (28d)</CardDescription>
            <CardTitle className="tabular text-2xl">
              {overview.searchConsole !== null
                ? formatNumber(overview.searchConsole.clicks)
                : "—"}
            </CardTitle>
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
    <div className="mx-auto max-w-5xl space-y-6">
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
