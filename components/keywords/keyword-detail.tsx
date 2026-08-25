import { ArrowLeft, ExternalLink, Link2 } from "lucide-react";
import Link from "next/link";

import { KeywordCard } from "@/components/keywords/keyword-card";
import { TrendChart } from "@/components/keywords/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  difficultyBand,
  formatCpc,
  formatNumber,
  formatVolume,
  INTENT_LABEL,
  INTENT_VARIANT,
} from "@/lib/keywords/format";
import type { KeywordDetail } from "@/lib/keywords/types";

function Metric({
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
      <p className={`tabular mt-1 text-2xl font-semibold ${className ?? ""}`}>
        {value}
      </p>
      {sub !== undefined && (
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

export function KeywordDetailView({
  detail,
  country,
}: {
  detail: KeywordDetail;
  country: string;
}) {
  const band = difficultyBand(detail.difficulty);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href={`/keywords?q=${encodeURIComponent(detail.keyword)}&country=${country}`}>
            <ArrowLeft />
            Back to results
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {detail.keyword}
          </h1>
          <Badge variant={INTENT_VARIANT[detail.intent]}>
            {INTENT_LABEL[detail.intent]}
          </Badge>
          <Badge variant="outline">{country.toUpperCase()}</Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Monthly searches"
          value={formatVolume(detail.volume)}
          sub={`${formatNumber(detail.volume)} per month`}
        />
        <Metric
          label="Difficulty"
          value={String(detail.difficulty)}
          sub={band.label}
          className={band.className}
        />
        <Metric label="Cost per click" value={formatCpc(detail.cpc)} />
        <Metric
          label="Paid competition"
          value={detail.competition.toFixed(2)}
          sub={`${formatNumber(detail.results)} results`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search trend</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart trend={detail.trend} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top 10 results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {detail.serp.map((r) => (
            <div
              key={r.position}
              className="flex items-start gap-3 rounded-lg border border-border p-3"
            >
              <span className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-muted text-xs font-semibold">
                {r.position}
              </span>

              <div className="min-w-0 flex-1">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium hover:underline"
                >
                  <span className="truncate">{r.title}</span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {r.domain}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {r.description}
                </p>
              </div>

              <dl className="hidden shrink-0 gap-4 text-right sm:flex">
                <div>
                  <dt
                    className="text-xs text-muted-foreground"
                    title="Domain strength — DataForSEO Rank when connected, otherwise Snaily Domain Authority. Not Moz DA."
                  >
                    DA
                  </dt>
                  <dd className="tabular text-sm font-medium">
                    {r.domainAuthority ?? "N/A"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    <Link2 className="ml-auto size-3" />
                  </dt>
                  <dd className="tabular text-sm font-medium">
                    {r.backlinks === null ? "N/A" : formatVolume(r.backlinks)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Words</dt>
                  <dd className="tabular text-sm font-medium">
                    {formatNumber(r.wordCount)}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-semibold">Related keywords</h2>
          {detail.related.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No related keywords found.
            </p>
          ) : (
            detail.related.map((k) => (
              <KeywordCard key={k.keyword} keyword={k} country={country} />
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Questions</h2>
          {detail.questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No question keywords found.
            </p>
          ) : (
            detail.questions.map((k) => (
              <KeywordCard key={k.keyword} keyword={k} country={country} />
            ))
          )}
        </section>
      </div>
    </div>
  );
}
