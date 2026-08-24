import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";

/**
 * Full-screen post editor — no Snaily app chrome, no content padding.
 * Mirrors WordPress's post.php: toolbar + canvas + settings sidebar.
 *
 * SetupProvider lives on the article [id] layout so the snapshot is for
 * the article's project, not the cookie's active project.
 */
export default async function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="h-svh max-h-svh w-full overflow-hidden bg-white">
      {children}
    </div>
  );
}
