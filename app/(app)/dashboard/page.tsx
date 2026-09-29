import { getSession } from "@/lib/auth";
import { listOpenAlerts } from "@/lib/alerts";
import { getProjectOverview } from "@/lib/dashboard/stats";
import { recentErrors } from "@/lib/errors";
import { getActiveProject } from "@/lib/projects";
import { isOwner } from "@/lib/users";

import {
  DashboardEmpty,
  DashboardOverview,
} from "@/components/dashboard-overview";

export const metadata = { title: "Overview · Snaily SEO" };

export default async function DashboardPage() {
  const [session, project] = await Promise.all([
    getSession(),
    getActiveProject(),
  ]);

  const firstName = session?.name.split(" ")[0] ?? "there";

  if (!project) {
    return <DashboardEmpty firstName={firstName} />;
  }

  const overview = await getProjectOverview(project.id, session!.userId);
  const [alerts, errors] = await Promise.all([
    listOpenAlerts(project.id),
    session && (await isOwner(session.userId))
      ? recentErrors(8)
      : Promise.resolve([]),
  ]);

  return (
    <DashboardOverview
      project={project}
      overview={overview}
      firstName={firstName}
      alerts={alerts}
      errors={errors}
    />
  );
}
