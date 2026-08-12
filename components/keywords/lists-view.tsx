"use client";

import { ChevronDown, ChevronRight, Download, List, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadCsv, toCsv } from "@/lib/keywords/csv";
import {
  difficultyBand,
  formatCpc,
  formatVolume,
  INTENT_LABEL,
  INTENT_VARIANT,
} from "@/lib/keywords/format";
import { opportunityBand } from "@/lib/keywords/opportunity";
import type { Keyword } from "@/lib/keywords/types";

export type ListDetail = {
  id: string;
  name: string;
  country: string;
  updatedAt: string;
  keywords: (Keyword & { opportunity: number })[];
};

export function ListsView({ lists }: { lists: ListDetail[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(lists[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  async function deleteList(id: string, name: string) {
    if (!confirm(`Delete the list "${name}"? This cannot be undone.`)) return;

    setBusy(true);
    const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
    setBusy(false);

    if (!res.ok) {
      toast.error("Could not delete this list");
      return;
    }
    toast.success("List deleted");
    router.refresh();
  }

  async function removeKeyword(listId: string, keyword: string) {
    setBusy(true);
    const res = await fetch(
      `/api/lists/${listId}?keyword=${encodeURIComponent(keyword)}`,
      { method: "DELETE" },
    );
    setBusy(false);

    if (!res.ok) {
      toast.error("Could not remove this keyword");
      return;
    }
    toast.success("Keyword removed");
    router.refresh();
  }

  if (lists.length === 0) {
    return (
      <EmptyState
        icon={List}
        title="No saved lists yet"
        description="Select keywords in Bulk Analysis and save them into a list."
        action={{ href: "/keywords/bulk", label: "Go to Bulk Analysis" }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {lists.map((list) => {
        const open = openId === list.id;

        return (
          <div key={list.id} className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 p-3">
              <button
                type="button"
                onClick={() => {
                  setOpenId(open ? null : list.id);
                }}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {open ? (
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate font-medium">{list.name}</span>
                <Badge variant="secondary">{list.keywords.length}</Badge>
                <Badge variant="outline">{list.country.toUpperCase()}</Badge>
              </button>

              <Button
                variant="outline"
                size="sm"
                disabled={list.keywords.length === 0}
                onClick={() => {
                  downloadCsv(
                    `${list.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
                    toCsv(list.keywords),
                  );
                  toast.success(`Exported ${String(list.keywords.length)} keywords`);
                }}
              >
                <Download />
                CSV
              </Button>

              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label={`Delete list ${list.name}`}
                onClick={() => void deleteList(list.id, list.name)}
              >
                <Trash2 className="text-destructive" />
              </Button>
            </div>

            {open && (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">Keywords in {list.name}</caption>
                  <thead className="bg-muted/50">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Keyword
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Volume
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        KD
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        CPC
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Intent
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Opportunity
                      </th>
                      <th scope="col" className="w-10 px-3 py-2">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.keywords.map((k) => {
                      const kd = difficultyBand(k.difficulty);
                      const opp = opportunityBand(k.opportunity);

                      return (
                        <tr key={k.keyword} className="border-t border-border">
                          <td className="max-w-xs px-3 py-2">
                            <Link
                              href={`/keywords/${encodeURIComponent(k.keyword)}?country=${list.country}`}
                              className="block truncate hover:underline"
                            >
                              {k.keyword}
                            </Link>
                          </td>
                          <td className="tabular px-3 py-2 text-right">
                            {formatVolume(k.volume)}
                          </td>
                          <td className={`tabular px-3 py-2 text-right ${kd.className}`}>
                            {k.difficulty}
                          </td>
                          <td className="tabular px-3 py-2 text-right">
                            {formatCpc(k.cpc)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={INTENT_VARIANT[k.intent]}>
                              {INTENT_LABEL[k.intent]}
                            </Badge>
                          </td>
                          <td
                            className={`tabular px-3 py-2 text-right font-semibold ${opp.className}`}
                          >
                            {k.opportunity}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`Remove ${k.keyword}`}
                              onClick={() => void removeKeyword(list.id, k.keyword)}
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
            )}
          </div>
        );
      })}
    </div>
  );
}
