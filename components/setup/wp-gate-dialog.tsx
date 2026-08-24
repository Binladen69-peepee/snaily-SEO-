"use client";

import { Plug } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type WpGateReason = "not_configured" | "connection_lost" | "outdated";

/**
 * Copy per failure. `outdated` is the case the user actually hits most: the
 * site is connected and the token is fine, the installed plugin is simply an
 * older build that does not have the route being called.
 */
const COPY: Record<
  WpGateReason,
  { title: string; body: string; cta: string }
> = {
  not_configured: {
    title: "WordPress setup is incomplete",
    body: "Install and connect the Snaily SEO WordPress connector to send drafts directly to WordPress.",
    cta: "Finish Setup",
  },
  connection_lost: {
    title: "Connection lost",
    body: "Your WordPress connector is no longer active. Reinstall and connect the Snaily SEO plugin to send drafts.",
    cta: "Reconnect",
  },
  outdated: {
    title: "Plugin update needed",
    body: "Your site is connected, but the installed connector is an older version that does not support this action. Download the latest plugin, then in WordPress deactivate and delete the old one before uploading it — WordPress will not overwrite an existing plugin. Your token stays the same.",
    cta: "Update plugin",
  },
};

export function WpGateDialog({
  open,
  reason,
  onOpenChange,
  onFinishSetup,
}: {
  open: boolean;
  reason: WpGateReason;
  onOpenChange: (open: boolean) => void;
  onFinishSetup: () => void;
}) {
  const copy = COPY[reason];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onFinishSetup}>
            <Plug />
            {copy.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
