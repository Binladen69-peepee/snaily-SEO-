import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  difficultyBand,
  formatCpc,
  formatNumber,
  formatVolume,
  INTENT_LABEL,
  INTENT_VARIANT,
} from "@/lib/keywords/format";
import type { Keyword } from "@/lib/keywords/types";

function Sparkline({ trend }: { trend: number[] }) {
  const max = Math.max(...trend, 1);
  const min = Math.min(...trend);
  const range = max - min || 1;
  const points = trend
    .map((v, i) => {
      const x = (i / (trend.length - 1)) * 100;
      const y = 24 - ((v - min) / range) * 22 - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="h-6 w-20 shrink-0 text-primary"
      role="img"
      aria-label="12-month search trend"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function KeywordCard({
  keyword,
  country,
}: {
  keyword: Keyword;
  country: string;
}) {
  const band = difficultyBand(keyword.difficulty);

  return (
    <Link
      href={`/keywords/${encodeURIComponent(keyword.keyword)}?country=${country}`}
      className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{keyword.keyword}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={INTENT_VARIANT[keyword.intent]}>
              {INTENT_LABEL[keyword.intent]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatNumber(keyword.results)} results
            </span>
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="mt-4 grid grid-cols-2 items-end gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Volume</p>
          <p className="tabular text-lg font-semibold">
            {formatVolume(keyword.volume)}
          </p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Difficulty</p>
          <div className="flex items-center gap-2">
            <span className={`tabular text-lg font-semibold ${band.className}`}>
              {keyword.difficulty}
            </span>
            <span className={`text-xs ${band.className}`}>{band.label}</span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${band.bar}`}
              style={{ width: `${String(keyword.difficulty)}%` }}
            />
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">CPC</p>
          <p className="tabular text-lg font-semibold">
            {formatCpc(keyword.cpc)}
          </p>
        </div>

        <div className="flex flex-col items-start gap-0.5">
          <p className="text-xs text-muted-foreground">Trend</p>
          <Sparkline trend={keyword.trend} />
        </div>
      </div>
    </Link>
  );
}
