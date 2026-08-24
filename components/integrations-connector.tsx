"use client";

import { Plug } from "lucide-react";

import { ConnectorPanel } from "@/components/setup/connector-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The WordPress connector, per project, on the Integrations screen.
 *
 * Integrations is where someone goes to ask "what is connected and is it
 * current", and until now the connector was the one integration that could
 * only be inspected by opening a project. The panel is the same component
 * Project Settings renders, pointed at the same endpoint and the same download
 * route — the point is that the two can never disagree about the version.
 */
export function IntegrationsConnector({
  projects,
}: {
  projects: { id: string; name: string; url: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="size-4 text-muted-foreground" aria-hidden />
          WordPress Connector
        </CardTitle>
        <CardDescription>
          The plugin that lets Snaily SEO read your posts and deliver drafts. It
          can never publish or edit a live post.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects yet. Add one to connect a WordPress site.
          </p>
        ) : (
          projects.map((project) => (
            <ConnectorPanel
              key={project.id}
              projectId={project.id}
              projectName={project.name}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
