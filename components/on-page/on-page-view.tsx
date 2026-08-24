"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Globe,
  Loader2,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/tool-shell";
import type { CannibalGroup } from "@/lib/seo/cannibalization";
import type { OnPageResult } from "@/lib/seo/analyze";
import type { TechnicalSeoResult } from "@/lib/seo/technical";
import { cn } from "@/lib/utils";

type Tab = "analyze" | "technical" | "cannibal";

function SerpPreview({ title, description, url }: { title: string; description: string; url: string }) {
  let displayUrl = url;
  try {
    const u = new URL(url);
    displayUrl = `${u.hostname}${u.pathname}`;
  } catch {
    /* keep raw */
  }

  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Google snippet preview
      </p>
      <div className="max-w-full space-y-0.5 overflow-hidden rounded-md bg-background p-3">
        <p className="truncate text-xs text-[#bdc1c6] sm:text-sm">{displayUrl}</p>
        <p
          className="text-base leading-snug text-[#8ab4f8] sm:text-xl"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title.trim() !== "" ? title : "Missing page title"}
        </p>
        <p
          className="text-xs leading-relaxed text-[#bdc1c6] sm:text-sm"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {description.trim() !== ""
            ? description
            : "No meta description — Google will pick text from the page."}
        </p>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Title: {title.length}/60 · Meta: {description.length}/160
      </p>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 80 ? "text-success" : score >= 50 ? "text-warning" : "text-destructive";
  return (
    <div className="flex flex-row items-center justify-center gap-3 rounded-xl border border-border bg-card p-4 sm:flex-col sm:gap-0 sm:p-6">
      <p className={`tabular text-3xl font-semibold sm:text-4xl ${color}`}>{score}</p>
      <p className="text-xs text-muted-foreground">On-page score</p>
    </div>
  );
}

export function OnPageView({
  projectId,
  projectUrl,
}: {
  projectId: string | null;
  projectUrl: string | null;
}) {
  const [tab, setTab] = useState<Tab>("analyze");
  const [url, setUrl] = useState(projectUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OnPageResult | null>(null);
  const [technical, setTechnical] = useState<TechnicalSeoResult | null>(null);
  const [cannibal, setCannibal] = useState<CannibalGroup[] | null>(null);
  const [loadingSite, setLoadingSite] = useState(false);

  useEffect(() => {
    if (projectId === null) return;
    setLoadingSite(true);
    void fetch(`/api/on-page?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data: { technical?: TechnicalSeoResult; cannibalization?: CannibalGroup[] }) => {
        setTechnical(data.technical ?? null);
        setCannibal(data.cannibalization ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        setLoadingSite(false);
      });
  }, [projectId]);

  async function analyze() {
    if (url.trim() === "") return;
    setBusy(true);
    try {
      const res = await fetch("/api/on-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as { result?: OnPageResult; error?: string };
      if (!res.ok || !data.result) {
        toast.error(data.error ?? "Could not analyze URL");
        return;
      }
      setResult(data.result);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  if (projectId === null) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <PageHeader
          title="On-Page SEO"
          description="Analyze any URL, preview your Google snippet, and check technical setup."
        />
        <EmptyState
          icon={FileSearch}
          title="No project selected"
          description="Add a project to run site-wide technical checks and cannibalization reports."
          action={{ href: "/projects", label: "Add a project" }}
        />
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "analyze", label: "URL analyzer" },
    { id: "technical", label: "Technical SEO" },
    { id: "cannibal", label: "Cannibalization" },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <PageHeader
        title="On-Page SEO"
        description="Analyze pages, preview snippets, and catch technical issues before Google does."
      />

      <div className="scroll-x -mx-1 flex gap-1.5 px-1 pb-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
            }}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors",
              tab === t.id
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "analyze" && (
        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="on-page-url">Page URL</Label>
                <Input
                  id="on-page-url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void analyze();
                  }}
                  placeholder="https://example.com/page"
                  className="min-w-0"
                />
              </div>
              <Button
                className="w-full shrink-0 sm:w-auto"
                onClick={() => void analyze()}
                disabled={busy || url.trim() === ""}
              >
                {busy ? <Loader2 className="animate-spin" /> : <FileSearch />}
                Analyze
              </Button>
            </div>
          </section>

          {result !== null && (
            <>
              <div className="grid gap-3 sm:gap-4 md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                <ScoreRing score={result.score} />
                <SerpPreview
                  title={result.title}
                  description={result.metaDescription}
                  url={result.url}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                {result.checks.map((c) => (
                  <div
                    key={c.id}
                    className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-card p-3"
                  >
                    {c.pass ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="break-words text-xs text-muted-foreground">
                        {c.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border bg-card p-4 text-sm">
                <p className="font-medium">Page details</p>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Canonical</dt>
                    <dd className="break-all">{result.canonical || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Internal links</dt>
                    <dd>{result.internalLinkCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Indexable</dt>
                    <dd>{result.indexable ? "Yes" : "No (noindex)"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Final URL</dt>
                    <dd>
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 break-all hover:underline"
                      >
                        {result.url}
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "technical" && (
        <div className="space-y-4">
          {loadingSite ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking robots.txt and sitemap…
            </div>
          ) : technical !== null ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <Globe className="size-4 text-muted-foreground" />
                    <p className="font-medium">robots.txt</p>
                    <Badge variant={technical.robots.found ? "success" : "warning"}>
                      {technical.robots.found ? "Found" : "Missing"}
                    </Badge>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <li>Status: {technical.robots.status || "—"}</li>
                    <li>Disallow rules: {technical.robots.disallowRules}</li>
                    <li>
                      Sitemap declared:{" "}
                      {technical.robots.hasSitemap ? "Yes" : "No"}
                    </li>
                    {technical.robots.blocksAll && (
                      <li className="text-destructive">
                        Warning: robots.txt blocks all crawlers
                      </li>
                    )}
                  </ul>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <FileSearch className="size-4 text-muted-foreground" />
                    <p className="font-medium">XML sitemap</p>
                    <Badge variant={technical.sitemap.found ? "success" : "warning"}>
                      {technical.sitemap.found ? "Found" : "Missing"}
                    </Badge>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {technical.sitemap.url !== null && (
                      <li className="break-all">{technical.sitemap.url}</li>
                    )}
                    {technical.sitemap.found && (
                      <li>~{technical.sitemap.urlCount} URLs listed</li>
                    )}
                    {!technical.sitemap.found && (
                      <li>No sitemap found at common paths</li>
                    )}
                  </ul>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Checked {technical.origin}. Submit your sitemap in Google Search
                Console after fixing any issues.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Could not load technical data.</p>
          )}
        </div>
      )}

      {tab === "cannibal" && (
        <div className="space-y-4">
          {loadingSite ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Scanning latest audit for competing pages…
            </div>
          ) : cannibal === null ? (
            <p className="text-sm text-muted-foreground">Could not load report.</p>
          ) : cannibal.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No cannibalization detected"
              description="Run a site audit first. This report compares page titles from your latest crawl to find pages competing for the same topic."
              action={{ href: "/audit", label: "Run site audit" }}
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {cannibal.length} group{cannibal.length === 1 ? "" : "s"} from your
                latest audit. Merge, differentiate, or canonicalize these pages.
              </p>
              <div className="space-y-3">
                {cannibal.map((group) => (
                  <div
                    key={group.pages.map((p) => p.url).join("|")}
                    className="rounded-lg border border-warning/40 bg-card p-4"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                      <p className="text-sm">{group.reason}</p>
                    </div>
                    <ul className="mt-3 space-y-2">
                      {group.pages.map((p) => (
                        <li key={p.url} className="text-sm">
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium hover:underline"
                          >
                            {p.path}
                          </a>
                          <p className="text-xs text-muted-foreground">{p.title}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
