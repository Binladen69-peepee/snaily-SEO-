import { OnPageView } from "@/components/on-page/on-page-view";
import { getActiveProject } from "@/lib/projects";

export const metadata = { title: "On-Page SEO · Snaily SEO" };

export default async function OnPagePage() {
  const project = await getActiveProject();

  return (
    <OnPageView
      projectId={project?.id ?? null}
      projectUrl={project?.url ?? null}
    />
  );
}
