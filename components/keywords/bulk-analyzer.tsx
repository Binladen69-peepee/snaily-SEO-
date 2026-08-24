"use client";

import { Download, Loader2, Play, Save, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { BulkSummaryCards } from "@/components/keywords/bulk-summary";
import {
  BulkTable,
  sortRows,
  type Row,
  type SortDir,
  type SortKey,
} from "@/components/keywords/bulk-table";
import { SaveToListDialog } from "@/components/keywords/save-to-list-dialog";
import { ErrorState } from "@/components/keywords/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadCsv, extractKeywordsFromFile, toCsv } from "@/lib/keywords/csv";
import { INTENT_LABEL } from "@/lib/keywords/format";
import {
  MAX_BULK_KEYWORDS,
  parseKeywordInput,
  summarize,
} from "@/lib/keywords/opportunity";
import { COUNTRIES, INTENTS, type SearchIntent } from "@/lib/keywords/types";

type Filters = {
  volumeMin: string;
  difficultyMax: string;
  cpcMin: string;
  intent: SearchIntent | "";
  contains: string;
};

const EMPTY_FILTERS: Filters = {
  volumeMin: "",
  difficultyMax: "",
  cpcMin: "",
  intent: "",
  contains: "",
};

export function BulkAnalyzer({
  projectId,
  isMock,
  initialKeywords = "",
  initialCountry = "us",
}: {
  projectId: string | null;
  isMock: boolean;
  /** Pre-filled from another screen, e.g. Deep Dive's Bulk Check button. */
  initialKeywords?: string;
  initialCountry?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [input, setInput] = useState(initialKeywords);
  const [country, setCountry] = useState(initialCountry);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("opportunity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveOpen, setSaveOpen] = useState(false);

  const parsedCount = useMemo(() => parseKeywordInput(input).length, [input]);
  const overLimit = parsedCount > MAX_BULK_KEYWORDS;

  const visible = useMemo(() => {
    if (rows === null) return [];

    const filtered = rows.filter((r) => {
      const volMin = Number(filters.volumeMin);
      const kdMax = Number(filters.difficultyMax);
      const cpcMin = Number(filters.cpcMin);

      if (filters.volumeMin !== "" && r.volume < volMin) return false;
      if (filters.difficultyMax !== "" && r.difficulty > kdMax) return false;
      if (filters.cpcMin !== "" && r.cpc < cpcMin) return false;
      if (filters.intent !== "" && r.intent !== filters.intent) return false;
      if (
        filters.contains !== "" &&
        !r.keyword.includes(filters.contains.trim().toLowerCase())
      )
        return false;
      return true;
    });

    return sortRows(filtered, sortKey, sortDir);
  }, [rows, filters, sortKey, sortDir]);

  const summary = useMemo(() => summarize(visible), [visible]);
  const selectedRows = useMemo(
    () => visible.filter((r) => selected.has(r.keyword)),
    [visible, selected],
  );

  const hasFilters = Object.values(filters).some((v) => v !== "");

  async function analyze() {
    setLoading(true);
    setError(null);
    setSelected(new Set());

    /*
     * Everything below runs inside try/finally.
     *
     * It did not, and that was the whole bug: a bulk run is dozens of live
     * SERP lookups, and when it exceeded the function timeout the platform
     * returned an HTML error page. `res.json()` threw on it, the rejection
     * escaped, and `setLoading(false)` never ran — so the button sat on its
     * spinner forever with no message. Any failure now ends with the spinner
     * cleared and a reason on screen.
     */
    try {
      const res = await fetch("/api/keywords/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: input, country }),
      });

      // A gateway timeout or a proxy error page is not JSON.
      let data: { error?: string; results?: Row[] } = {};
      try {
        data = (await res.json()) as { error?: string; results?: Row[] };
      } catch {
        setError(
          res.status === 504 || res.status === 502
            ? "That took too long. Try fewer keywords at once."
            : `The server returned an unexpected response (${String(res.status)}).`,
        );
        setRows(null);
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "Could not analyze these keywords.");
        setRows(null);
        return;
      }

      setRows(data.results ?? []);
    } catch {
      setError("Could not reach the server. Your keywords are still here.");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1_000_000) {
      toast.error("File is too large. The limit is 1 MB.");
      return;
    }

    void file.text().then((text) => {
      const extracted = extractKeywordsFromFile(text);
      setInput((prev) => (prev.trim() === "" ? extracted : `${prev}\n${extracted}`));
      toast.success(`Loaded ${file.name}`);
    });

    e.target.value = "";
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Text sorts read better ascending; numbers read better descending.
      setSortDir(key === "keyword" || key === "intent" ? "asc" : "desc");
    }
  }

  function toggleOne(keyword: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      visible.every((r) => prev.has(r.keyword))
        ? new Set()
        : new Set(visible.map((r) => r.keyword)),
    );
  }

  function exportCsv() {
    const rowsToExport = selectedRows.length > 0 ? selectedRows : visible;
    downloadCsv(
      `keywords-${country}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rowsToExport),
    );
    toast.success(`Exported ${String(rowsToExport.length)} keywords`);
  }

  return (
    <div className="space-y-5">
      {/* ---------- Input ---------- */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="keywords">Keywords</Label>
            <span
              className={`text-xs ${overLimit ? "text-destructive" : "text-muted-foreground"}`}
            >
              {parsedCount} / {MAX_BULK_KEYWORDS}
            </span>
          </div>

          <Textarea
            id="keywords"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
            }}
            placeholder={"seo tools\ncontent marketing\nkeyword research, link building"}
            className="min-h-40 font-mono text-xs"
            aria-describedby="keywords-hint"
          />
          <p id="keywords-hint" className="text-xs text-muted-foreground">
            One per line, or separated by commas. Duplicates are removed
            automatically.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void analyze()} disabled={loading || parsedCount === 0 || overLimit}>
            {loading ? <Loader2 className="animate-spin" /> : <Play />}
            Analyze {parsedCount > 0 && !overLimit ? parsedCount : ""}
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            onChange={onFile}
            className="hidden"
          />
          <Button
            variant="outline"
            onClick={() => {
              fileRef.current?.click();
            }}
          >
            <Upload />
            Upload TXT / CSV
          </Button>

          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
            }}
            aria-label="Country"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>

          {input !== "" && (
            <Button
              variant="ghost"
              onClick={() => {
                setInput("");
                setRows(null);
                setError(null);
              }}
            >
              <X />
              Clear
            </Button>
          )}

          {isMock && (
            <Badge variant="warning" className="ml-auto">
              Sample data
            </Badge>
          )}
        </div>

        {overLimit && (
          <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Too many keywords. Remove {parsedCount - MAX_BULK_KEYWORDS} to stay
            within the {MAX_BULK_KEYWORDS} limit.
          </p>
        )}
      </div>

      {/* ---------- Results ---------- */}
      {error !== null && <ErrorState message={error} />}

      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Analyzing {parsedCount} keywords…
        </div>
      )}

      {!loading && rows !== null && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="font-medium">No keywords analyzed</p>
          <p className="text-sm text-muted-foreground">
            Check your input and try again.
          </p>
        </div>
      )}

      {!loading && rows !== null && rows.length > 0 && (
        <>
          <BulkSummaryCards summary={summary} />

          {/* Filters */}
          <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="space-y-1.5">
              <Label htmlFor="fVol">Min volume</Label>
              <Input
                id="fVol"
                type="number"
                min={0}
                value={filters.volumeMin}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, volumeMin: e.target.value }));
                }}
                placeholder="0"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fKd">Max difficulty</Label>
              <Input
                id="fKd"
                type="number"
                min={0}
                max={100}
                value={filters.difficultyMax}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, difficultyMax: e.target.value }));
                }}
                placeholder="100"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fCpc">Min CPC</Label>
              <Input
                id="fCpc"
                type="number"
                min={0}
                step="0.01"
                value={filters.cpcMin}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, cpcMin: e.target.value }));
                }}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fIntent">Intent</Label>
              <select
                id="fIntent"
                value={filters.intent}
                onChange={(e) => {
                  setFilters((f) => ({
                    ...f,
                    intent: e.target.value as SearchIntent | "",
                  }));
                }}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Any</option>
                {INTENTS.map((i) => (
                  <option key={i} value={i}>
                    {INTENT_LABEL[i]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fContains">Contains</Label>
              <Input
                id="fContains"
                value={filters.contains}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, contains: e.target.value }));
                }}
                placeholder="word"
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="ghost"
                disabled={!hasFilters}
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                }}
              >
                <X />
                Clear filters
              </Button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {visible.length === rows.length
                ? `${rows.length} keywords`
                : `${visible.length} of ${rows.length} keywords`}
              {selected.size > 0 && ` · ${selected.size} selected`}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => {
                  setSaveOpen(true);
                }}
              >
                <Save />
                Save to list
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={visible.length === 0}
                onClick={exportCsv}
              >
                <Download />
                Export CSV
                {selected.size > 0 ? ` (${String(selected.size)})` : ""}
              </Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-14 text-center">
              <p className="font-medium">No keywords match these filters</p>
              <p className="text-sm text-muted-foreground">
                Try widening or clearing them.
              </p>
            </div>
          ) : (
            <BulkTable
              rows={visible}
              country={country}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
              selected={selected}
              onToggle={toggleOne}
              onToggleAll={toggleAll}
            />
          )}

          <SaveToListDialog
            open={saveOpen}
            onOpenChange={setSaveOpen}
            keywords={selectedRows}
            projectId={projectId}
            country={country}
            onSaved={() => {
              setSelected(new Set());
            }}
          />
        </>
      )}
    </div>
  );
}
