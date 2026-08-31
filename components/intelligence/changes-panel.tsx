import { ArrowDown, ArrowUp, FileMinus2, FilePlus2, Minus } from "lucide-react";

import { formatCrawlTime } from "@/lib/intelligence/dates";

import { Badge } from "@/components/ui/badge";
import { ISSUE_LABEL } from "@/lib/audit/types";
import type { Comparison, IssueDelta } from "@/lib/intelligence/types";

function Delta({
  label,
  value,
  higherIsBetter,
}: {
  label: string;
  value: number;
  higherIsBetter: boolean;
}) {
  const good = value === 0 ? null : higherIsBetter ? value > 0 : value < 0;
  const Icon = value === 0 ? Minus : value > 0 ? ArrowUp : ArrowDown;

  return (
    <div className="rounded-lg border border-border bg-background p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`tabular mt-1 flex items-center justify-center gap-1 text-2xl font-semibold ${
          good === null
            ? "text-muted-foreground"
            : good
              ? "text-success"
              : "text-destructive"
        }`}
      >
        <Icon className="size-4" />
        {value > 0 ? "+" : ""}
        {value}
      </p>
    </div>
  );
}

function IssueList({
  items,
  total,
  tone,
}: {
  items: IssueDelta[];
  total: number;
  tone: "destructive" | "success";
}) {
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">None since last crawl.</p>;

  return (
    <>
      <ul className="space-y-2 text-sm">
        {items.map((d, i) => (
          <li
            key={`${d.url}-${d.code}-${String(i)}`}
            className="flex items-start gap-2 rounded-md border border-border p-2"
          >
            <Badge
              variant={tone === "success" ? "success" : "destructive"}
              className="mt-0.5 shrink-0"
            >
              {ISSUE_LABEL[d.code]}
            </Badge>
            <span className="truncate text-muted-foreground" title={d.path}>
              {d.path}
            </span>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          +{total - items.length} more not shown
        </p>
      )}
    </>
  );
}

export function ChangesPanel({ comparison }: { comparison: Comparison }) {
  const improved =
    comparison.healthDelta > 0 || comparison.issueDelta < 0;
  const regressed =
    comparison.healthDelta < 0 || comparison.issueDelta > 0;

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-semibold">What changed since the last crawl</h2>
          <p className="text-xs text-muted-foreground">
            Compared with audit from{" "}
            {formatCrawlTime(comparison.previousDate)}
          </p>
        </div>
        {improved && !regressed && (
          <Badge variant="success">Improving</Badge>
        )}
        {regressed && !improved && (
          <Badge variant="destructive">Regressing</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-4">
        <Delta label="Health score" value={comparison.healthDelta} higherIsBetter />
        <Delta
          label="Total issues"
          value={comparison.issueDelta}
          higherIsBetter={false}
        />
        <Delta label="Pages crawled" value={comparison.pagesDelta} higherIsBetter />
        <div className="rounded-lg border border-border bg-background p-3 text-center">
          <p className="text-xs text-muted-foreground">Pages changed</p>
          <p className="tabular mt-1 text-2xl font-semibold">
            {comparison.changedPages}
          </p>
        </div>
      </div>

      <div className="grid gap-5 p-4 md:grid-cols-2">
        <div>
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="tabular rounded-md bg-destructive/10 px-2 py-0.5 text-destructive">
              +{comparison.newIssueCount}
            </span>
            Newly introduced issues
          </p>
          <IssueList
            items={comparison.newIssues}
            total={comparison.newIssueCount}
            tone="destructive"
          />
        </div>

        <div>
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="tabular rounded-md bg-success/10 px-2 py-0.5 text-success">
              +{comparison.resolvedIssueCount}
            </span>
            Resolved issues
          </p>
          <IssueList
            items={comparison.resolvedIssues}
            total={comparison.resolvedIssueCount}
            tone="success"
          />
        </div>
      </div>

      {(comparison.newPages.length > 0 || comparison.removedPages.length > 0) && (
        <div className="grid gap-5 border-t border-border p-4 md:grid-cols-2">
          {comparison.newPages.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                <FilePlus2 className="size-4 text-success" />
                New pages discovered ({comparison.newPages.length})
              </p>
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {comparison.newPages.map((p) => (
                  <li key={p.url} className="truncate font-mono text-xs">
                    {p.path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {comparison.removedPages.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                <FileMinus2 className="size-4 text-destructive" />
                Pages no longer found ({comparison.removedPages.length})
              </p>
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {comparison.removedPages.map((p) => (
                  <li key={p.url} className="truncate font-mono text-xs">
                    {p.path}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
