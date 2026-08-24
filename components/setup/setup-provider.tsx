"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { FinishSetupDialog } from "@/components/setup/finish-setup-dialog";
import { SetupFab } from "@/components/setup/setup-fab";
import {
  WpGateDialog,
  type WpGateReason,
} from "@/components/setup/wp-gate-dialog";
import { WpUpdateDialog } from "@/components/setup/wp-update-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SetupSnapshot } from "@/lib/setup/state";

type SetupContextValue = {
  snapshot: SetupSnapshot | null;
  snoozed: boolean;
  openSetup: (opts?: { reason?: "not_configured" | "connection_lost" }) => void;
  openWpGate: (reason: WpGateReason, onRetry?: () => void) => void;
  setSnapshot: (next: SetupSnapshot | null) => void;
  snooze: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
};

const SetupContext = createContext<SetupContextValue | null>(null);

export function useSetup(): SetupContextValue {
  const ctx = useContext(SetupContext);
  if (ctx === null) {
    return {
      snapshot: null,
      snoozed: true,
      openSetup: () => undefined,
      openWpGate: () => undefined,
      setSnapshot: () => undefined,
      snooze: async () => undefined,
      refreshSnapshot: async () => undefined,
    };
  }
  return ctx;
}

export function SetupProvider({
  snapshot: initial,
  snoozed: initialSnoozed,
  hideFab = false,
  projectId: projectIdProp,
  children,
}: {
  snapshot: SetupSnapshot | null;
  snoozed: boolean;
  /** Full-screen editors (Drafter) keep the FAB off the writing canvas. */
  hideFab?: boolean;
  /** Used to fetch a snapshot when the layout did not have one yet. */
  projectId?: string;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [snoozed, setSnoozed] = useState(initialSnoozed);
  const [setupOpen, setSetupOpen] = useState(false);
  const [gate, setGate] = useState<WpGateReason | null>(
    null,
  );
  const pathname = usePathname();
  const onWizard = pathname.includes("/setup");
  const resolvedProjectId =
    snapshot?.projectId ?? initial?.projectId ?? projectIdProp;

  useEffect(() => {
    setSnapshot(initial);
    setSnoozed(initialSnoozed);
    // Only re-hydrate when the active project changes — a live connect in the
    // dialog must not be overwritten by a stale layout snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.projectId]);

  const openSetup = useCallback(() => {
    setGate(null);
    setSetupOpen(true);
  }, []);

  /**
   * What to run once the connector is confirmed updated.
   *
   * Held in a ref so the dialog can retry the exact action that failed —
   * sending an article, syncing posts — instead of leaving the user to find
   * the button again after a multi-step detour into WordPress.
   */
  const retryRef = useRef<(() => void) | null>(null);

  const openWpGate = useCallback(
    (reason: WpGateReason, onRetry?: () => void) => {
      retryRef.current = onRetry ?? null;
      setGate(reason);
    },
    [],
  );

  const snooze = useCallback(async () => {
    if (!snapshot) return;
    try {
      await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: snapshot.projectId }),
      });
      setSnoozed(true);
    } catch {
      setSnoozed(true);
    }
  }, [snapshot]);

  const refreshSnapshot = useCallback(async () => {
    const id = snapshot?.projectId ?? initial?.projectId ?? projectIdProp;
    if (!id) return;
    try {
      const res = await fetch(`/api/setup?projectId=${id}`);
      const data = (await res.json()) as {
        snapshot?: SetupSnapshot;
        snoozed?: boolean;
      };
      if (data.snapshot) setSnapshot(data.snapshot);
    } catch {
      /* keep the last known snapshot */
    }
  }, [snapshot?.projectId, initial?.projectId, projectIdProp]);

  useEffect(() => {
    if (!setupOpen || snapshot !== null) return;
    if (!resolvedProjectId) return;
    void refreshSnapshot();
  }, [setupOpen, snapshot, resolvedProjectId, refreshSnapshot]);

  const value = useMemo(
    () => ({
      snapshot,
      snoozed,
      openSetup,
      openWpGate,
      setSnapshot,
      snooze,
      refreshSnapshot,
    }),
    [snapshot, snoozed, openSetup, openWpGate, snooze, refreshSnapshot],
  );

  const showChrome =
    snapshot !== null &&
    snapshot.needsWordpressAttention &&
    !snapshot.reminderMuted;

  return (
    <SetupContext.Provider value={value}>
      {children}
      {snapshot !== null ? (
        <FinishSetupDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          snapshot={snapshot}
          onSnapshot={(next) => {
            setSnapshot(next);
          }}
        />
      ) : (
        <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Finish Setup</DialogTitle>
              <DialogDescription>
                Connect WordPress from Integrations, then send the draft again.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSetupOpen(false)}>
                Cancel
              </Button>
              <Button asChild>
                <Link href="/integrations">Open Integrations</Link>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {/* An out-of-date plugin gets the guided update flow, not the generic
          "finish setup" prompt — the fix is three specific WordPress steps. */}
      <WpUpdateDialog
        open={gate === "outdated"}
        projectId={resolvedProjectId ?? null}
        onOpenChange={(v) => {
          if (!v) setGate(null);
        }}
        onVerified={() => {
          setGate(null);
          void refreshSnapshot();
          const retry = retryRef.current;
          retryRef.current = null;
          retry?.();
        }}
      />
      <WpGateDialog
        open={gate !== null && gate !== "outdated"}
        reason={gate === "connection_lost" ? "connection_lost" : "not_configured"}
        onOpenChange={(v) => {
          if (!v) setGate(null);
        }}
        onFinishSetup={() => {
          setGate(null);
          setSetupOpen(true);
        }}
      />
      {showChrome && !snoozed && !setupOpen && !onWizard && !hideFab && snapshot !== null && (
        <SetupFab
          snapshot={snapshot}
          onFinish={() => setSetupOpen(true)}
          onSnooze={() => void snooze()}
        />
      )}
    </SetupContext.Provider>
  );
}
