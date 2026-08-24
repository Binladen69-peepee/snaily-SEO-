"use client";

import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/tool-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type AffiliateRow = {
  id: string;
  term: string;
  category: string;
  url: string;
  kind: string;
  enabled: boolean;
};

type ImportResult = {
  imported: number;
  enabled: number;
  affiliate: number;
  internal: number;
  skippedNoUrl: number;
  skippedBadUrl: number;
  disabledGenerics: string[];
};

/**
 * The ingredient → URL sheet.
 *
 * Two things this screen has to make obvious, because both are invisible in
 * the spreadsheet itself: which rows are affiliate links (they get
 * rel="sponsored nofollow") versus links to the site's own recipes (they must
 * not), and which terms are switched off. A bare "salt" linking to Amazon in
 * every post is the single clearest thin-affiliate signal there is, so those
 * arrive off and have to be turned on deliberately.
 */
export function AffiliateLinksView({
  projectId,
  projectName,
  initialLinks,
}: {
  projectId: string | null;
  projectName: string | null;
  initialLinks: AffiliateRow[];
}) {
  const [links, setLinks] = useState(initialLinks);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<
    "all" | "affiliate" | "internal" | "off"
  >("all");
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(
    () => ({
      total: links.length,
      enabled: links.filter((l) => l.enabled).length,
      affiliate: links.filter((l) => l.kind === "affiliate").length,
      internal: links.filter((l) => l.kind === "internal").length,
    }),
    [links],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return links
      .filter((l) => {
        if (filter === "affiliate" && l.kind !== "affiliate") return false;
        if (filter === "internal" && l.kind !== "internal") return false;
        if (filter === "off" && l.enabled) return false;
        return (
          q === "" || l.term.includes(q) || l.category.toLowerCase().includes(q)
        );
      })
      .slice(0, 300);
  }, [links, query, filter]);

  /** Pulls the live list from the site's Easy Affiliate Links plugin. */
  async function syncFromWordPress() {
    if (projectId === null) return;
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch("/api/affiliate-links/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as {
        imported?: number;
        aliases?: number;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Could not read links from WordPress.");
        return;
      }
      toast.success(
        `Synced ${String(data.imported ?? 0)} links from WordPress${
          data.aliases ? ` (${String(data.aliases)} aliases)` : ""
        }.`,
      );
      const listed = await fetch(`/api/affiliate-links?projectId=${projectId}`);
      const next = (await listed.json()) as { links?: AffiliateRow[] };
      setLinks(next.links ?? []);
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSyncing(false);
    }
  }

  async function upload(file: File) {
    if (projectId === null) return;
    setImporting(true);
    setResult(null);
    try {
      const csv = await file.text();
      const res = await fetch("/api/affiliate-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, csv }),
      });
      const data = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Import failed");
        return;
      }
      setResult(data);
      toast.success(`Imported ${String(data.imported)} ingredients`);

      const listed = await fetch(`/api/affiliate-links?projectId=${projectId}`);
      const next = (await listed.json()) as { links?: AffiliateRow[] };
      setLinks(next.links ?? []);
    } catch {
      toast.error("Could not read that file");
    } finally {
      setImporting(false);
    }
  }

  async function toggle(row: AffiliateRow) {
    // Flipped immediately: the round trip is only a persist, and 500 rows of
    // waiting spinners would make bulk tidying unusable.
    setLinks((prev) =>
      prev.map((l) => (l.id === row.id ? { ...l, enabled: !l.enabled } : l)),
    );
    try {
      const res = await fetch("/api/affiliate-links", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, enabled: !row.enabled }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setLinks((prev) =>
        prev.map((l) => (l.id === row.id ? { ...l, enabled: row.enabled } : l)),
      );
      toast.error("Could not save that change");
    }
  }

  if (projectId === null) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-5">
        <PageHeader title="Ingredient Links" />
        <p className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center text-sm text-muted-foreground">
          Create a project first — ingredient links are stored per site.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <PageHeader
        title="Ingredient Links"
        description={
          projectName === null
            ? "Ingredient names and the URLs they link to."
            : `Ingredient names and the URLs they link to, for ${projectName}.`
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button
          onClick={() => void syncFromWordPress()}
          disabled={syncing || importing}
          className="gap-2"
        >
          {syncing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          Sync from WordPress
        </Button>
        <Button
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={importing || syncing}
          className="gap-2"
        >
          {importing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          Import spreadsheet
        </Button>
      </PageHeader>

      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Expects three columns:{" "}
        <code className="rounded bg-muted px-1">canonical_ingredient</code>,{" "}
        <code className="rounded bg-muted px-1">category</code>,{" "}
        <code className="rounded bg-muted px-1">affiliate_url</code>. Importing
        replaces the whole list, but anything you have switched off stays off.
        Links are applied to the first mention of each ingredient inside the
        <strong> Ingredients</strong> and <strong>Recipe</strong> sections only,
        when the Drafter writes a draft.
      </div>

      {result !== null && (
        <div className="rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Check className="size-4 text-success" aria-hidden />
            Imported {result.imported} ingredients — {result.affiliate}{" "}
            affiliate, {result.internal} to your own recipes.
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            {result.skippedNoUrl > 0 && (
              <li>{result.skippedNoUrl} rows had no URL and were skipped.</li>
            )}
            {result.skippedBadUrl > 0 && (
              <li>
                {result.skippedBadUrl} rows had something other than a URL in
                the link column (usually the category repeated).
              </li>
            )}
            {result.disabledGenerics.length > 0 && (
              <li>
                Imported switched off, because linking them everywhere reads as
                thin affiliate content:{" "}
                <strong>{result.disabledGenerics.join(", ")}</strong>. Turn any
                of them on below.
              </li>
            )}
          </ul>
        </div>
      )}

      {links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="font-medium">No ingredient links yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Import your spreadsheet to turn ingredient mentions into links
            automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Ingredients", value: counts.total },
              { label: "Active", value: counts.enabled },
              { label: "Affiliate", value: counts.affiliate },
              { label: "Your own recipes", value: counts.internal },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-border bg-card p-3 shadow-sm"
              >
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="tabular mt-0.5 text-xl font-semibold">
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-80">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                placeholder="Search ingredients"
                aria-label="Search ingredients"
                className="pl-8"
              />
            </div>
            <div
              role="group"
              aria-label="Filter"
              className="flex overflow-hidden rounded-md border border-border"
            >
              {(["all", "affiliate", "internal", "off"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => {
                    setFilter(f);
                  }}
                  className={cn(
                    "px-2.5 py-1.5 text-xs font-medium capitalize transition-colors",
                    filter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {f === "internal" ? "Own site" : f}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Ingredient links</caption>
              <thead className="bg-muted/50">
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Ingredient
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Links to
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Active
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr
                    key={l.id}
                    className={cn(
                      "border-t border-border",
                      !l.enabled && "opacity-55",
                    )}
                  >
                    <td className="px-3 py-2">
                      <span className="block truncate font-medium">
                        {l.term}
                      </span>
                      {l.category !== "" && (
                        <span className="text-xs text-muted-foreground">
                          {l.category}
                        </span>
                      )}
                    </td>
                    <td className="max-w-0 px-3 py-2">
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 truncate text-xs text-primary hover:underline"
                      >
                        <span className="truncate">{l.url}</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      {l.kind === "internal" ? (
                        <Badge variant="secondary">Own site</Badge>
                      ) : (
                        <Badge variant="success">Affiliate</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={l.enabled}
                        aria-label={`${l.enabled ? "Disable" : "Enable"} ${l.term}`}
                        onClick={() => void toggle(l)}
                        className={cn(
                          "inline-flex h-5 w-9 items-center rounded-full transition-colors",
                          l.enabled ? "bg-primary" : "bg-muted-foreground/30",
                        )}
                      >
                        <span
                          className={cn(
                            "size-4 rounded-full bg-white transition-transform",
                            l.enabled ? "translate-x-4" : "translate-x-0.5",
                          )}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {shown.length === 0 && (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                Nothing matches that filter.
              </p>
            )}
          </div>

          {links.length > shown.length && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="size-3.5" aria-hidden />
              Showing {shown.length} of {links.length}. Search to narrow it
              down.
            </p>
          )}
        </>
      )}
    </div>
  );
}
