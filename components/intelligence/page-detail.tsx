import {
  AlertCircle,
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  ExternalLink,
  Info,
  TrendingDown,
} from "lucide-react";

import { ScoreBreakdown } from "@/components/intelligence/score-breakdown";
import { Badge } from "@/components/ui/badge";
import { ISSUE_LABEL, SEVERITY_WEIGHT } from "@/lib/audit/types";
import {
  EFFORT_LABEL,
  RECOMMENDATIONS,
  type Effort,
} from "@/lib/intelligence/recommendations";
import type { PageIntel } from "@/lib/intelligence/types";

const EFFORT_VARIANT: Record<Effort, "success" | "warning" | "destructive"> = {
  quick: "success",
  moderate: "warning",
  involved: "destructive",
};

const SEVERITY_ICON = {
  high: AlertCircle,
  medium: AlertTriangle,
  low: Info,
} as const;

const SEVERITY_COLOR = {
  high: "text-destructive",
  medium: "text-warning",
  low: "text-muted-foreground",
} as const;

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm sm:flex-row sm:gap-2">
      <span className="shrink-0 text-muted-foreground sm:w-32">{label}</span>
      <span className="min-w-0 break-all">{value}</span>
    </div>
  );
}

export function PageDetail({ page }: { page: PageIntel }) {
  const actions = [...page.issues].sort(
    (a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity],
  );

  return (
    <div className="space-y-6">
      {/* ---- Scores ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ScoreBreakdown
          title="Priority Score"
          subtitle="How urgently Google needs this fixed"
          score={page.priority}
          accent={page.priority.score >= 40 ? "text-destructive" : "text-foreground"}
        />
        <ScoreBreakdown
          title="Opportunity Score"
          subtitle="Biggest SEO gain per unit of effort"
          score={page.opportunity}
          accent={page.opportunity.score >= 40 ? "text-success" : "text-foreground"}
        />
      </div>

      {/* ---- Decay signals ---- */}
      {page.decay.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-warning">
            <TrendingDown className="size-4" />
            Content decay detected
          </p>
          <ul className="space-y-1.5 text-sm">
            {page.decay.map((d) => (
              <li key={d.code} className="flex gap-2">
                <span className="font-medium text-warning">{d.label}</span>
                <span className="text-muted-foreground">{d.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Action list ---- */}
      {actions.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" />
          No issues found on this page — nothing to do right now.
        </div>
      ) : (
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Action list — work top to bottom
          </p>
          <ol className="space-y-3">
            {actions.map((issue, i) => {
              const rec = RECOMMENDATIONS[issue.code];
              const SevIcon = SEVERITY_ICON[issue.severity];
              return (
                <li
                  key={issue.code}
                  className="flex gap-3 rounded-lg border border-border bg-card p-4"
                >
                  <span className="tabular mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <SevIcon
                        className={`size-3.5 shrink-0 ${SEVERITY_COLOR[issue.severity]}`}
                      />
                      <span className="font-semibold">{ISSUE_LABEL[issue.code]}</span>
                      <Badge variant={EFFORT_VARIANT[rec.effort]}>
                        {EFFORT_LABEL[rec.effort]}
                      </Badge>
                      {issue.detail && (
                        <span className="text-xs text-muted-foreground">
                          {issue.detail}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{rec.action}</p>
                    <p className="text-xs text-muted-foreground">{rec.why}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* ---- Broken links ---- */}
      {page.brokenLinks.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <AlertCircle className="size-4" />
            {page.brokenLinks.length} broken link
            {page.brokenLinks.length === 1 ? "" : "s"} on this page
          </p>
          <ul className="space-y-0.5 text-xs text-destructive/80">
            {page.brokenLinks.slice(0, 10).map((l) => (
              <li key={l} className="break-all font-mono">
                {l}
              </li>
            ))}
            {page.brokenLinks.length > 10 && (
              <li className="text-muted-foreground">
                +{page.brokenLinks.length - 10} more
              </li>
            )}
          </ul>
        </div>
      )}

      {/* ---- Performance (GSC) ---- */}
      {page.performance && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <BarChart2 className="size-4 text-primary" />
            Search Console — last 28 days
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Clicks</p>
              <p className="tabular text-xl font-semibold">
                {page.performance.clicks.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Impressions</p>
              <p className="tabular text-xl font-semibold">
                {page.performance.impressions.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg. position</p>
              <p className="tabular text-xl font-semibold">
                {page.performance.position.toFixed(1)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ---- Page metadata ---- */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Page details
        </p>
        <MetaRow label="Title" value={page.title || <span className="italic text-muted-foreground">None</span>} />
        <MetaRow label="Words" value={String(page.wordCount)} />
        <MetaRow label="Internal links" value={String(page.internalLinkCount)} />
        {page.lastModified && (
          <MetaRow
            label="Last modified"
            value={new Date(page.lastModified).toLocaleDateString()}
          />
        )}
      </div>

      <a
        href={page.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        Open page in browser
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}
