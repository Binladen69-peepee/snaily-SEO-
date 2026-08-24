"use client";

import { Loader2, Snail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Google's brand mark, inlined so the button needs no network request. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

type Mode = "login" | "register";

export function AuthForm({
  mode,
  /** Message handed back by the Google callback, e.g. "Not authorized". */
  googleError = null,
}: {
  mode: Mode;
  googleError?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === "register";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form) as Record<string, string>;

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      toast.success(isRegister ? "Account created" : "Welcome back");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader className="text-center">
        <span
          aria-hidden
          className="mx-auto mb-1 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"
        >
          <Snail className="size-6" />
        </span>
        <CardTitle className="text-xl">
          {isRegister ? "Create your account" : "Welcome back"}
        </CardTitle>
        <CardDescription>
          {isRegister
            ? "Start tracking your content performance."
            : "Sign in to Snaily SEO to continue."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/*
          Google is the primary path: one grant covers sign-in, Search Console
          and Analytics, so there is no separate "connect" step afterwards.
        */}
        {!isRegister && (
          <>
            {googleError !== null && (
              <p
                role="alert"
                className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {googleError}
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              className="h-11 w-full gap-2.5"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                window.location.href = "/api/auth/google";
              }}
            >
              <GoogleMark />
              Continue with Google
            </Button>

            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" aria-hidden />
              <span className="text-xs text-muted-foreground">
                or use a password
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </div>
          </>
        )}

        {/*
          method="post" matters even though submission is handled in JS. A
          submit that lands before hydration falls back to the browser's
          native behaviour, and the default is GET — which would put the
          password in the URL, the history entry and the access log.
        */}
        
        <form onSubmit={onSubmit} method="post" className="space-y-4" noValidate>
          {isRegister && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                required
                placeholder="Jane Doe"
                disabled={loading}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              minLength={isRegister ? 8 : undefined}
              placeholder={isRegister ? "At least 8 characters" : "••••••••"}
              disabled={loading}
            />
          </div>

          {error !== null && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {isRegister ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {isRegister ? "Already have an account? " : "No account yet? "}
          <Link
            href={isRegister ? "/login" : "/register"}
            className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            {isRegister ? "Sign in" : "Create one"}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}


