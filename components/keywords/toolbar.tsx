"use client";

import {
  BarChart3,
  CheckSquare,
  Download,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import type { Row } from "@/components/keywords/bulk-table";
import { CompareDialog } from "@/components/keywords/compare-dialog";
import { FilterDialog } from "@/components/keywords/filters";
import { SaveToListDialog } from "@/components/keywords/save-to-list-dialog";
import { downloadCsv, toCsv } from "@/lib/keywords/csv";

/**
 * Shared state between the search strip and the keyword list.
 *
 * KeySearch puts Filter / Bulk Check / Save / Compare / Export in the top strip
 * but has them act on the rows ticked in the table below. Those two sit in
 * different parts of the tree, so the selection is held above both.
 */
type ToolbarValue = {
  rows: Row[];
  selected: Set<string>;
  country: string;
  projectId: string | null;
  setSelected: (next: Set<string>) => void;
  /** Called by the table when a new result set reaches the client. */
  publish: (rows: Row[], country: string, projectId: string | null) => void;
};

const ToolbarContext = createContext<ToolbarValue | null>(null);

export function useKeywordToolbar(): ToolbarValue {
  const ctx = useContext(ToolbarContext);
  if (ctx === null) {
    throw new Error("useKeywordToolbar must be used inside KeywordToolbar");
  }
  return ctx;
}

export function KeywordToolbar({ children }: { children: React.ReactNode }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [country, setCountry] = useState("us");
  const [projectId, setProjectId] = useState<string | null>(null);

  const publish = useCallback(
    (next: Row[], nextCountry: string, nextProject: string | null) => {
      setRows(next);
      setCountry(nextCountry);
      setProjectId(nextProject);
      setSelected(new Set()); // a fresh result set invalidates the selection
    },
    [],
  );

  const value = useMemo(
    () => ({ rows, selected, country, projectId, setSelected, publish }),
    [rows, selected, country, projectId, publish],
  );

  return (
    <ToolbarContext.Provider value={value}>{children}</ToolbarContext.Provider>
  );
}

const BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded border border-border bg-card px-2.5 text-[12.5px] whitespace-nowrap text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The button cluster on the right of the search strip. */
export function ToolbarActions({
  activeFilterCount,
}: {
  activeFilterCount: number;
}) {
  const { rows, selected, country, projectId, setSelected } =
    useKeywordToolbar();

  const [filterOpen, setFilterOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const chosen = rows.filter((r) => selected.has(r.keyword));

  function exportCsv() {
    const target = chosen.length > 0 ? chosen : rows;
    if (target.length === 0) {
      toast.error("Search for a keyword first");
      return;
    }
    downloadCsv(`keywords-${Date.now().toString()}.csv`, toCsv(target));
    toast.success(`Exported ${String(target.length)} keywords`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className={BUTTON}
        onClick={() => {
          setFilterOpen(true);
        }}
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filter
        {activeFilterCount > 0 && (
          <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
      </button>

      <Link href="/bulk-check" className={BUTTON}>
        <CheckSquare className="size-3.5" aria-hidden />
        Bulk Check
      </Link>

      <button
        type="button"
        className={BUTTON}
        onClick={() => {
          if (rows.length === 0) {
            toast.error("Search for a keyword first");
            return;
          }
          setSaveOpen(true);
        }}
      >
        <Save className="size-3.5" aria-hidden />
        Save Keywords
      </button>

      <button
        type="button"
        className={BUTTON}
        onClick={() => {
          if (chosen.length < 2) {
            toast.error("Tick at least two keywords to compare");
            return;
          }
          setCompareOpen(true);
        }}
      >
        <BarChart3 className="size-3.5" aria-hidden />
        Compare
      </button>

      <button type="button" className={BUTTON} onClick={exportCsv}>
        <Download className="size-3.5" aria-hidden />
        Export
      </button>

      <FilterDialog open={filterOpen} onOpenChange={setFilterOpen} />
      <CompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        keywords={chosen}
      />
      <SaveToListDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        keywords={chosen.length > 0 ? chosen : rows}
        projectId={projectId}
        country={country}
        onSaved={() => {
          setSelected(new Set());
        }}
      />
    </div>
  );
}
