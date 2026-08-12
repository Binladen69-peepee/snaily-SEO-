import type { Score } from "@/lib/intelligence/types";
import { cn } from "@/lib/utils";

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 70
      ? "bg-destructive"
      : score >= 40
        ? "bg-warning"
        : score >= 15
          ? "bg-primary"
          : "bg-muted-foreground";
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", color)}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export function ScoreBreakdown({
  title,
  subtitle,
  score,
  accent,
}: {
  title: string;
  subtitle?: string;
  score: Score;
  accent: string;
}) {
  if (score.reasons.length === 0) {
    return (
      <div className="rounded-lg border border-success/20 bg-success/5 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
        <p className="tabular mt-1 text-2xl font-semibold text-success">0</p>
        <ScoreBar score={0} />
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing to fix — this page is in good shape.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {subtitle && (
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      )}
      <p className={cn("tabular mt-1 text-2xl font-semibold", accent)}>
        {score.score}
      </p>
      <ScoreBar score={score.score} />

      <ul className="mt-3 space-y-1.5 text-sm">
        {score.reasons.map((r, i) => (
          <li
            key={`${r.label}-${String(i)}`}
            className="flex items-baseline gap-2"
          >
            <span className="tabular w-7 shrink-0 text-right text-xs font-semibold text-muted-foreground">
              +{r.points}
            </span>
            <span className="min-w-0">
              {r.label}
              {r.detail !== undefined && r.detail !== "" && (
                <span className="text-muted-foreground"> — {r.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {score.score === 100 && (
        <p className="mt-2 text-xs text-muted-foreground">Score capped at 100.</p>
      )}
    </div>
  );
}
