import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Header } from "@/components/header";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { SetupProvider } from "@/components/setup/setup-provider";
import { TopNav } from "@/components/top-nav";
import { getSession, isImpersonating } from "@/lib/auth";
import { getActiveProject, getProjects } from "@/lib/projects";
import { getSetupSnapshot, SNOOZE_COOKIE } from "@/lib/setup/state";
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

  const snapshot = activeProject
    ? await getSetupSnapshot(activeProject.id)
    : null;

  const snoozeRaw = (await cookies()).get(SNOOZE_COOKIE)?.value ?? "";
  const snoozed =
    snapshot !== null &&
    snoozeRaw.startsWith(`${snapshot.projectId}:`) &&
    Number(snoozeRaw.slice(snapshot.projectId.length + 1)) > Date.now();

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
   * against `100svh - 56px`, which behaves correctly inside a scrolling page.
   */
  return (
    <SetupProvider snapshot={snapshot} snoozed={snoozed}>
      <div className="min-h-svh w-full max-w-[100vw] overflow-x-clip">
      {/* Above the nav so it cannot be scrolled out of sight. */}
      {isImpersonating(session) && (
        <ImpersonationBanner
          actingAs={session.name}
          ownerName={session.impersonatorName ?? "your account"}
        />
      )}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <TopNav
          isOwner={owner}
          projects={projects}
          activeProjectId={activeProject?.id ?? null}
        >
          <Header
            name={session.name}
            email={session.email}
            projects={projects}
            activeProjectId={activeProject?.id ?? null}
            isOwner={owner}
          />
        </TopNav>
        <main
          id="main-content"
          className="app-main app-gutter min-w-0 max-w-full overflow-x-clip"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </SetupProvider>
  );
}
