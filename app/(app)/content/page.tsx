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
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Content Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">
            {report
              ? `Audit from ${new Date(report.auditDate).toLocaleString()} · ${String(report.summary.totalPages)} pages crawled`
              : "Prioritised fixes drawn from your latest site audit."}
          </p>
        </div>

        {report && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2">
            <div className="text-right">
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
              </p>
            </div>
            <div className="h-10 w-10 overflow-hidden rounded-full border-4 border-muted flex items-center justify-center">
              <div
                className={`text-xs font-bold ${
                  report.healthScore >= 80
                    ? "text-success"
                    : report.healthScore >= 50
                      ? "text-warning"
                      : "text-destructive"
                }`}
              >
                /100
              </div>
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
