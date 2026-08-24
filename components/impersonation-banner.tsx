"use client";

import { Loader2, LogOut, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Persistent notice that this is somebody else's account.
 *
 * Deliberately loud and impossible to dismiss. The failure mode for
 * impersonation is forgetting you are in it and changing real settings or
 * sending real content as that person, so the way out is always one click away
 * and the name is always on screen.
 */
export function ImpersonationBanner({
  actingAs,
  ownerName,
}: {
  actingAs: string;
  ownerName: string;
}) {
  const [leaving, setLeaving] = useState(false);

  async function stop() {
    setLeaving(true);
    try {
      const res = await fetch("/api/users/impersonate/stop", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not switch back");
        setLeaving(false);
        return;
      }
      toast.success(`Back to ${ownerName}`);
      // Full reload: every server component on screen was rendered for the
      // impersonated user and must be rebuilt for the owner.
      window.location.assign("/users");
    } catch {
      toast.error("Could not reach the server");
      setLeaving(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b-2 border-warning bg-warning/15 px-4 py-2 text-center text-xs font-medium text-foreground"
    >
      <span className="inline-flex items-center gap-1.5">
        <UserCog className="size-3.5 shrink-0 text-warning" aria-hidden />
        You are signed in as <strong>{actingAs}</strong>. Anything you do is
        recorded against their account.
      </span>
      <button
        type="button"
        onClick={() => void stop()}
        disabled={leaving}
        className="inline-flex items-center gap-1.5 rounded-md bg-warning-foreground/15 px-2.5 py-1 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
      >
        {leaving ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <LogOut className="size-3.5" aria-hidden />
        )}
        Return to {ownerName}
      </button>
    </div>
  );
}
