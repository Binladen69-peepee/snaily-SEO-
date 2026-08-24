import { FileText } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PostsView } from "@/components/posts/posts-view";
import { buildUpdateQueue } from "@/lib/content/update-queue";
import { getActiveProject } from "@/lib/projects";
import { getStatus } from "@/lib/wordpress/sync";

export const metadata = { title: "Content Library · Snaily SEO" };

export default async function PostsPage() {
  const project = await getActiveProject();

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-7xl">
        <EmptyState
          icon={FileText}
          title="No project selected"
          description="The content library shows posts synced from a project's WordPress site."
          action={{ href: "/projects", label: "Add a project" }}
        />
      </div>
    );
  }

  const [status, queue] = await Promise.all([
    getStatus(project.id),
    buildUpdateQueue(project.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <PostsView
        projectId={project.id}
        projectName={project.name}
        status={status}
        posts={queue.posts}
        missingPerformance={queue.missingPerformance}
      />
    </div>
  );
}
