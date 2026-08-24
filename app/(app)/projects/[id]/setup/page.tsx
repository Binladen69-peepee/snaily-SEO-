import { notFound } from "next/navigation";

import { SetupWizard } from "@/components/setup-wizard";
import { getSession } from "@/lib/auth";
import { isValidId, prisma } from "@/lib/db";
import { getGoogleAccountPublic } from "@/lib/google/account";
import { getSetupSnapshot } from "@/lib/setup/state";
import { getStatus } from "@/lib/wordpress/sync";

export const metadata = { title: "Set up project · Snaily SEO" };

export default async function ProjectSetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !isValidId(id)) notFound();

  const project = await prisma.project.findFirst({
    where: { id, userId: session.userId },
    select: {
      id: true,
      name: true,
      url: true,
      gscSiteUrl: true,
      gscSiteName: true,
      ga4PropertyId: true,
      ga4PropertyName: true,
    },
  });

  if (!project) notFound();

  const [status, account, snapshot] = await Promise.all([
    getStatus(project.id),
    getGoogleAccountPublic(session.userId),
    getSetupSnapshot(project.id),
  ]);

  return (
    <SetupWizard
      project={project}
      initialStatus={status}
      googleEmail={account?.email ?? null}
      initialSnapshot={snapshot}
    />
  );
}
