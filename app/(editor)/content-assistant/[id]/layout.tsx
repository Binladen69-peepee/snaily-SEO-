import { cookies } from "next/headers";

import { SetupProvider } from "@/components/setup/setup-provider";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { getSetupSnapshot, SNOOZE_COOKIE } from "@/lib/setup/state";

/**
 * Drafter editor chrome is project-specific. Snapshot must come from the
 * article's project, not the cookie's active project.
 */
export default async function EditorArticleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  let snapshot = null;
  let projectId: string | undefined;
  if (session && isValidId(id)) {
    const article = await prisma.article.findFirst({
      where: { id, userId: session.userId },
      select: { projectId: true },
    });
    if (article) {
      projectId = article.projectId;
      snapshot = await getSetupSnapshot(article.projectId);
    }
  }

  const snoozeRaw = (await cookies()).get(SNOOZE_COOKIE)?.value ?? "";
  const snoozed =
    snapshot !== null &&
    snoozeRaw.startsWith(`${snapshot.projectId}:`) &&
    Number(snoozeRaw.slice(snapshot.projectId.length + 1)) > Date.now();

  return (
    <SetupProvider
      snapshot={snapshot}
      snoozed={snoozed}
      hideFab
      projectId={projectId}
    >
      {children}
    </SetupProvider>
  );
}
