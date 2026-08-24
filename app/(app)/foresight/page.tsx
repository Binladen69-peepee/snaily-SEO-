import { TrendingUp } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ForesightView } from "@/components/foresight/foresight-view";
import { getSession } from "@/lib/auth";
import { buildForecast } from "@/lib/foresight/forecast";
import { defaultAssumptions } from "@/lib/foresight/scenario";
import { listForecasts } from "@/lib/foresight/store";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "Foresight · Snaily SEO" };

/**
 * Built on the server for the first paint.
 *
 * The engine reads a project's whole evidence base — every synced Search
 * Console row, every cached SERP, the latest audit — so the first render is a
 * few seconds of work. Doing it here means the page arrives complete rather
 * than as a skeleton that fills in, and every later change of scenario or
 * horizon is a much cheaper refetch of the same endpoint.
 */
export default async function ForesightPage() {
  const [session, project] = await Promise.all([getSession(), getActiveProject()]);

  if (!session || project === null) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <EmptyState
          icon={TrendingUp}
          title="No project selected"
          description="Foresight models outcomes for one project at a time. Create or choose a project to begin."
        />
      </div>
    );
  }

  const assumptions = defaultAssumptions("expected", 6);

  const [forecast, saved] = await Promise.all([
    buildForecast({
      projectId: project.id,
      siteUrl: project.url,
      userId: session.userId,
      assumptions,
    }),
    listForecasts(session.userId, project.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <ForesightView
        projectId={project.id}
        projectName={project.name}
        initialForecast={forecast}
        initialSaved={saved}
      />
    </div>
  );
}
