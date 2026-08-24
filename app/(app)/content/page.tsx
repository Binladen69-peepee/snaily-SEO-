import { Gauge } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { IntelligenceView } from "@/components/intelligence/intelligence-view";
import { getSession } from "@/lib/auth";
import { buildReport } from "@/lib/intelligence/report";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Content Intelligence · Snaily SEO" };

export default async function ContentIntelligencePage() {
  const [session, project] = await Promise.all([
    getSession(),
    getActiveProject(),
  ]);

  const report =
    session && project ? await buildReport(session.userId, project.id) : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Content Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">
            {report
              ? `Audit from ${new Date(report.auditDate).toLocaleString()} · ${String(report.summary.totalPages)} pages`
              : "Prioritised fixes drawn from your latest site audit."}
          </p>
        </div>

        {report && (
          <div className="flex w-full shrink-0 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2 sm:w-auto sm:justify-end">
            <div>
              <p className="text-[11px] text-muted-foreground">Site health</p>
              <p
                className={`tabular text-2xl font-semibold ${
                  report.healthScore >= 80
                    ? "text-success"
                    : report.healthScore >= 50
                      ? "text-warning"
                      : "text-destructive"
                }`}
              >
                {report.healthScore}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {!project ? (
        <EmptyState
          icon={Gauge}
          title="No project selected"
          description="Content Intelligence analyses the pages of your active project."
          action={{ href: "/projects", label: "Add a project" }}
        />
      ) : report === null ? (
        <EmptyState
          icon={Gauge}
          title="No completed audit yet"
          description={`Crawl ${project.url.replace(/^https?:\/\//, "")} first — Content Intelligence is built from audit data.`}
          action={{ href: "/audit", label: "Run an audit" }}
        />
      ) : (
        <IntelligenceView report={report} />
      )}
    </div>
  );
}
