"use client";

import { KeyRound, Loader2, LogIn, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserDTO } from "@/lib/users";

export function UsersView({
  users,
  currentUserId,
}: {
  users: UserDTO[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form) as Record<string, string>;

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, role: "member" }),
    });
    const data = (await res.json()) as { error?: string };

    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "Could not create the account");
      return;
    }

    toast.success("Account created");
    setOpen(false);
    router.refresh();
  }

  /**
   * Owner-side edits to a teammate account.
   *
   * The owner needs to fix a wrong email, reset a forgotten password and
   * grant or revoke access without going near the database.
   */
  async function patch(user: UserDTO, body: Record<string, string>) {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not update this account");
        return;
      }
      toast.success("Account updated");
      router.refresh();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusyId(null);
    }
  }

  function editCredentials(user: UserDTO) {
    const name = window.prompt("Name", user.name);
    if (name === null) return;
    const email = window.prompt("Email", user.email);
    if (email === null) return;
    void patch(user, { name: name.trim(), email: email.trim() });
  }

  function resetPassword(user: UserDTO) {
    const password = window.prompt(
      `New password for ${user.email} (at least 8 characters)`,
    );
    if (password === null || password.trim() === "") return;
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    void patch(user, { password });
  }

  /**
   * Sign in as another account.
   *
   * Confirmed because it swaps the whole session — every screen after this
   * belongs to them, and it is recorded against the owner who started it.
   */
  async function signInAs(u: UserDTO) {
    if (
      !window.confirm(
        `Sign in as ${u.name} (${u.email})?

You will see their projects and data. A banner stays on screen until you switch back, and the session is logged.`,
      )
    ) {
      return;
    }
    setBusyId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}/impersonate`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not sign in as that user");
        setBusyId(null);
        return;
      }
      // Hard reload: every server component on screen was rendered for the
      // previous identity.
      window.location.assign("/dashboard");
    } catch {
      toast.error("Could not reach the server");
      setBusyId(null);
    }
  }

  async function remove(user: UserDTO) {
    if (
      !confirm(
        `Remove ${user.email}? Their projects, audits and keyword lists are deleted too.`,
      )
    ) {
      return;
    }

    setBusyId(user.id);
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    setBusyId(null);

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      toast.error(data.error ?? "Could not remove this account");
      return;
    }

    toast.success("Account removed");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {users.length} {users.length === 1 ? "account" : "accounts"}. There is
          no public sign-up — accounts only exist if you create them here.
        </p>
        <Button
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          <UserPlus />
          Add user
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">People with access to this tool</caption>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">Name</th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">Email</th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">Role</th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">Added</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2.5 font-medium">
                  {u.name}
                  {u.id === currentUserId && (
                    <span className="ml-2 text-xs text-muted-foreground">you</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{u.email}</td>
                <td className="px-3 py-2.5">
                  <select
                    value={u.role}
                    disabled={busyId === u.id}
                    aria-label={`Access level for ${u.email}`}
                    onChange={(e) => {
                      void patch(u, { role: e.target.value });
                    }}
                    className="h-7 rounded border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="member">member</option>
                    <option value="owner">owner</option>
                  </select>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <button
                    type="button"
                    disabled={busyId === u.id}
                    aria-label={`Edit ${u.email}`}
                    title="Edit name and email"
                    onClick={() => {
                      editCredentials(u);
                    }}
                    className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <UserPlus className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === u.id}
                    aria-label={`Reset password for ${u.email}`}
                    title="Set a new password"
                    onClick={() => {
                      resetPassword(u);
                    }}
                    className="ml-1 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <KeyRound className="size-3.5" />
                  </button>
                  {u.id !== currentUserId && (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      aria-label={`Sign in as ${u.email}`}
                      title="Sign in as this user"
                      onClick={() => void signInAs(u)}
                      className="ml-1 rounded p-1 text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <LogIn className="size-3.5" />
                    </button>
                  )}
                  {u.id !== currentUserId && (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      aria-label={`Remove ${u.email}`}
                      onClick={() => void remove(u)}
                      className="ml-1 rounded p-1 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {busyId === u.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a user</DialogTitle>
            <DialogDescription>
              They sign in with this email and password. Share the password with
              them directly — it is not emailed.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={create} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="u-name">Name</Label>
              <Input id="u-name" name="name" required placeholder="Jane Doe" disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-email">Email</Label>
              <Input
                id="u-email"
                name="email"
                type="email"
                required
                placeholder="va@example.com"
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-password">Temporary password</Label>
              <Input
                id="u-password"
                name="password"
                type="text"
                required
                minLength={8}
                placeholder="At least 8 characters"
                disabled={saving}
              />
            </div>

            {error !== null && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                Create account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
