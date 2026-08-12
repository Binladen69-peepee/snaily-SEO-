import { getSession } from "@/lib/auth";
import { getProjectOverview } from "@/lib/dashboard/stats";
import { getActiveProject } from "@/lib/projects";

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

  return (
    <DashboardOverview
      project={project}
      overview={overview}
      firstName={firstName}
    />
  );
}
