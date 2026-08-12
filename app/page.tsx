import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { needsBootstrap } from "@/lib/users";

/**
 * Private tool — there is no marketing page. Straight to the app, or to sign in.
 * Before any account exists, send the very first visitor to one-time setup.
 */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  redirect((await needsBootstrap()) ? "/register" : "/login");
}
