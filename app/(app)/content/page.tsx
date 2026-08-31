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

  /*
   * Which crawl this screen is showing, said plainly.
   *
   * Everything here comes from one audit — buildReport reads the latest
   * completed one and only that one's pages — but the screen never said which,
   * so a report the owner had already fixed the site against looked like a
   * current one. Naming the crawl, its size and what it still finds makes a
   * stale reading obvious instead of arguable.
   */
  const openIssues =
    report?.pages.reduce((sum, page) => sum + page.issues.length, 0) ?? 0;

  /*
   * Stated in UTC, with the zone named.
   *
   * toLocaleString() with no timezone uses whichever the runtime is in: UTC on
   * Vercel when this renders, the reader's own when React reaches it, and the
   * two strings disagree for everyone outside UTC. That is a real hydration
   * mismatch and it logged a React error on every load from, say, New Jersey.
   *
   * Guessing the reader's zone server-side would only move the guess. Naming
   * the zone is unambiguous for anyone, and a crawl timestamp is read for
   * "how old is this", which UTC answers exactly as well.
   */
  const crawledAt =
    report === null
      ? ""
      : new Intl.DateTimeFormat("en-GB", {
          timeZone: "UTC",
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(report.auditDate));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Content Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">
            {report
              ? `Crawled ${crawledAt} UTC · ${String(report.summary.totalPages)} pages audited · ${String(openIssues)} current issue${openIssues === 1 ? "" : "s"}`
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
