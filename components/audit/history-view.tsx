"use client";

import { History, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";

export type AuditHistoryItem = {
  id: string;
  status: "running" | "completed" | "failed";
  pagesCrawled: number;
  healthScore: number;
  totalIssues: number;
  startedAt: string;
  finishedAt: string | null;
};

export function HistoryView({ audits }: { audits: AuditHistoryItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(id: string) {
    if (!confirm("Delete this audit and its page data?")) return;

    setBusy(true);
    const res = await fetch(`/api/audits/${id}`, { method: "DELETE" });
    setBusy(false);

    if (!res.ok) {
      toast.error("Could not delete this audit");
      return;
    }
    toast.success("Audit deleted");
    router.refresh();
  }

  if (audits.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No audit history"
        description="Run your first audit to start tracking site health over time."
        action={{ href: "/audit", label: "Run an audit" }}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">Audit history for this project</caption>
        <thead className="bg-muted/50">
          <tr>
            <th scope="col" className="px-3 py-2.5 text-left font-medium">Date</th>
            <th scope="col" className="px-3 py-2.5 text-left font-medium">Status</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">Pages</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">Health</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">Issues</th>
            <th scope="col" className="w-10 px-3 py-2.5">
              <span className="sr-only">Delete</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {audits.map((a, i) => {
            const prev = audits[i + 1];
            const delta =
              prev && a.status === "completed" && prev.status === "completed"
                ? a.healthScore - prev.healthScore
                : null;

            return (
              <tr key={a.id} className="border-t border-border">
                <td className="px-3 py-2.5">
                  {new Date(a.startedAt).toLocaleString()}
                </td>
                <td className="px-3 py-2.5">
                  <Badge
                    variant={
                      a.status === "completed"
                        ? "success"
                        : a.status === "failed"
                          ? "destructive"
                          : "warning"
                    }
                  >
                    {a.status}
                  </Badge>
                </td>
                <td className="tabular px-3 py-2.5 text-right">{a.pagesCrawled}</td>
                <td className="tabular px-3 py-2.5 text-right">
                  {a.status === "completed" ? (
                    <>
                      <span className="font-semibold">{a.healthScore}</span>
                      {delta !== null && delta !== 0 && (
                        <span
                          className={`ml-1.5 text-xs ${delta > 0 ? "text-success" : "text-destructive"}`}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta}
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="tabular px-3 py-2.5 text-right">
                  {a.status === "completed" ? a.totalIssues : "—"}
                </td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="Delete audit"
                    onClick={() => void remove(a.id)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
