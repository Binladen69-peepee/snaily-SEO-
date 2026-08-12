import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { needsBootstrap } from "@/lib/users";

export const metadata = { title: "Set up Snaily SEO" };

/** One-time owner setup. Once an account exists this route is closed. */
export default async function RegisterPage() {
  if (!(await needsBootstrap())) redirect("/login");
  return <AuthForm mode="register" />;
}
