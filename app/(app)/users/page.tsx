import { notFound } from "next/navigation";

import { UsersView } from "@/components/users-view";
import { getSession } from "@/lib/auth";
import { isOwner, listUsers } from "@/lib/users";

export const metadata = { title: "Users · Snaily SEO" };

export default async function UsersPage() {
  const session = await getSession();
  if (!session || !(await isOwner(session.userId))) notFound();

  const users = await listUsers();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Who can sign in to Snaily SEO.
        </p>
      </div>

      <UsersView users={users} currentUserId={session.userId} />
    </div>
  );
}
