import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { GoogleProperties } from "@/components/google-properties";
import { ProjectSettings } from "@/components/project-settings";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleAccountPublic } from "@/lib/google/account";
import { autoLinkGoogleProperties } from "@/lib/google/auto-link";
import { getProjects } from "@/lib/projects";
import { getSetupSnapshot } from "@/lib/setup/state";

export const metadata = { title: "Project settings · Snaily SEO" };

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [session, project] = await Promise.all([
    getSession(),
    getProjects().then((all) => all.find((p) => p.id === id)),
  ]);

  if (!project || !session) notFound();

  /*
   * Link the obvious property before reading the links back.
   *
   * This is a one-site install: the account sees one Search Console property
   * and one Analytics property, both on this project's domain. Making the
   * owner pick between one option is not a choice, it is an obstacle - and the
   * obstacle is why Search Console never synced. Ambiguous cases still fall
   * through to the picker below.
   */
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "";
  const proto =
    head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  await autoLinkGoogleProperties(session.userId, id, `${proto}://${host}`);

  // Property links live on the project; tokens never leave the server.
  const [links, account, snapshot] = await Promise.all([
    prisma.project.findUnique({
      where: { id },
      select: {
        gscSiteUrl: true,
        gscSiteName: true,
        ga4PropertyId: true,
        ga4PropertyName: true,
      },
    }),
    getGoogleAccountPublic(session.userId),
    getSetupSnapshot(id),
  ]);

  return (
    /*
     * One measure for the whole screen. ProjectSettings used to impose its own
     * narrower width, so the Google card below it rendered wider and the page
     * read as two stacks rather than one.
     */
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <ProjectSettings project={project} snapshot={snapshot} />
      <GoogleProperties
        projectId={id}
        googleEmail={account?.email ?? null}
        initial={
          links ?? {
            gscSiteUrl: null,
            gscSiteName: null,
            ga4PropertyId: null,
            ga4PropertyName: null,
          }
        }
      />
    </div>
  );
}
