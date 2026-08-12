import { ProjectsList } from "@/components/projects-list";
import { getProjects } from "@/lib/projects";

export const metadata = { title: "Projects · Snaily SEO" };

export default async function ProjectsPage() {
  const projects = await getProjects();
  return <ProjectsList projects={projects} />;
}
