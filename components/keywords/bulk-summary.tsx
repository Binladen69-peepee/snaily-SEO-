import { difficultyBand, formatNumber, formatVolume } from "@/lib/keywords/format";
import { opportunityBand, type BulkSummary } from "@/lib/keywords/opportunity";

function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`tabular mt-1 truncate text-xl font-semibold ${className ?? ""}`}>
        {value}
      </p>
      {sub !== undefined && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

export function BulkSummaryCards({ summary }: { summary: BulkSummary }) {
  const kdBand = difficultyBand(summary.avgDifficulty);
  const oppBand =
    summary.best !== null ? opportunityBand(summary.best.opportunity) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Total keywords"
        value={formatNumber(summary.total)}
        sub={`${formatVolume(summary.totalVolume)} combined volume`}
      />
      <Stat
        label="Average volume"
        value={formatVolume(summary.avgVolume)}
        sub={`${formatNumber(summary.avgVolume)} per month`}
      />
      <Stat
        label="Average difficulty"
        value={String(summary.avgDifficulty)}
        sub={kdBand.label}
        className={kdBand.className}
      />
      <Stat
        label="Highest opportunity"
        value={summary.best?.keyword ?? "—"}
        sub={
          summary.best !== null
            ? `Score ${String(summary.best.opportunity)} · ${oppBand?.label ?? ""}`
            : undefined
        }
        className={oppBand?.className}
      />
    </div>
  );
}
