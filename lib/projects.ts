import { cookies } from "next/headers";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const ACTIVE_COOKIE = "activeProject";

export type ProjectDTO = {
  id: string;
  name: string;
  url: string;
  description: string;
};

/** All projects for the signed-in user, newest first. */
export async function getProjects(): Promise<ProjectDTO[]> {
  const session = await getSession();
  if (!session) return [];

  const docs = await prisma.project.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
  });

  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    url: d.url,
    description: d.description ?? "",
  }));
}

/**
 * The project currently being viewed. Falls back to the most recent one so the
 * app always has a project selected when at least one exists.
 */
export async function getActiveProject(): Promise<ProjectDTO | null> {
  const projects = await getProjects();
  if (projects.length === 0) return null;

  const activeId = (await cookies()).get(ACTIVE_COOKIE)?.value;
  return projects.find((p) => p.id === activeId) ?? projects[0]!;
}

export async function setActiveProject(id: string) {
  (await cookies()).set(ACTIVE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}
