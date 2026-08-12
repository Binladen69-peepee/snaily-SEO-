import { Snail } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await getSession()) redirect("/dashboard");

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <Link
        href="/"
        className="flex items-center gap-2 rounded text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Snail className="size-4" aria-hidden />
        </span>
        Snaily SEO
      </Link>
      {children}
    </main>
  );
}
