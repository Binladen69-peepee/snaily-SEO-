import { redirect } from "next/navigation";

import { Header } from "@/components/header";
import { TopNav } from "@/components/top-nav";
import { getSession } from "@/lib/auth";
import { getActiveProject, getProjects } from "@/lib/projects";
import { isOwner } from "@/lib/users";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [projects, activeProject, owner] = await Promise.all([
    getProjects(),
    getActiveProject(),
    isOwner(session.userId),
  ]);

  /*
   * The document scrolls, and the bar sticks to the top of it.
   *
   * The shell used to be a fixed `h-svh` flex column with the scroll container
   * nested inside. A flex item defaults to `min-height: auto`, so the wrapper
   * around <main> grew to its content height instead of shrinking, pushed past
   * the viewport, and the outer `overflow-hidden` clipped it — anything below
   * the fold became unreachable. Ordinary document scrolling cannot be trapped
   * that way, so nothing here constrains height.
   *
   * Pages that genuinely need a fixed split (Keyword Research) size themselves
   * against `100svh - 54px`, which behaves correctly inside a scrolling page.
   */
  return (
    <div className="min-h-svh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <TopNav isOwner={owner}>
        <Header
          name={session.name}
          email={session.email}
          projects={projects}
          activeProjectId={activeProject?.id ?? null}
          isOwner={owner}
        />
      </TopNav>
      <main id="main-content" className="p-4 sm:p-6" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
