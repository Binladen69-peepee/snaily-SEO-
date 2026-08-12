import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Sign in · Snaily SEO" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: Props) {
  const raw = await searchParams;
  const value = Array.isArray(raw.error) ? raw.error[0] : raw.error;

  return <AuthForm mode="login" googleError={value?.trim() || null} />;
}
