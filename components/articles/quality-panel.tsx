"use client";

import { AlertTriangle, Check, ExternalLink, Link2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { LinkVerdict } from "@/app/api/articles/[id]/links/route";
import {
  analyseReadability,
  LONG_SENTENCE,
  MAX_PARAGRAPH_SENTENCES,
} from "@/lib/drafter/readability";
import { cn } from "@/lib/utils";

/**
 * Writing quality and link health.
 *
 * The readability half is computed in the browser from the draft itself, so it
 * updates as you type and costs nothing. The link half has to ask the server,
 * because verifying an internal link means checking it against the site's
 * synced pages — the editor cannot know what exists on the live site.
 */

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular mt-0.5 text-lg font-semibold",
          tone === "good" && "text-success",
          tone === "warn" && "text-warning",
        )}
      >
        {value}
      </p>
      {hint !== undefined && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function anchorsOf(html: string): { href: string; anchor: string }[] {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map(
    (m) => ({
      href: m[1] ?? "",
      anchor: (m[2] ?? "").replace(/<[^>]+>/g, "").trim(),
    }),
  );
}

export function QualityPanel({
  html,
  articleId,
}: {
  html: string;
  articleId: string;
}) {
  const read = useMemo(() => analyseReadability(html), [html]);
  const links = useMemo(() => anchorsOf(html), [html]);

  const [verdicts, setVerdicts] = useState<LinkVerdict[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [indexed, setIndexed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links }),
      });
      const data = (await res.json()) as {
        verdicts?: LinkVerdict[];
        indexed?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not check links.");
        return;
      }
      setVerdicts(data.verdicts ?? []);
      setIndexed(data.indexed ?? null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setChecking(false);
    }
  }, [articleId, links]);

  // Verdicts describe the links as they were when checked, so they are dropped
  // the moment the draft changes rather than left to go quietly stale.
  useEffect(() => {
    setVerdicts(null);
  }, [html]);

  const unverified = verdicts?.filter(
    (v) => v.kind === "internal" && v.status === "unverified",
  );

  return (
    <div className="space-y-5">
      {/* ---------------- Readability ---------------- */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Readability
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Reading ease"
            value={read.flesch === null ? "—" : String(read.flesch)}
            hint={read.grade}
            tone={
              read.flesch === null ? "neutral" : read.flesch >= 60 ? "good" : "warn"
            }
          />
          <Stat
            label="Words / sentence"
            value={String(read.avgWordsPerSentence)}
            hint={`${String(read.sentences)} sentences`}
            tone={read.avgWordsPerSentence <= 20 ? "good" : "warn"}
          />
          <Stat
            label="Passive voice"
            value={`${String(read.passivePercent)}%`}
            hint="of sentences"
            tone={read.passivePercent <= 10 ? "good" : "warn"}
          />
          <Stat
            label="Sentences / paragraph"
            value={String(read.avgSentencesPerParagraph)}
            hint="house style is 2.2"
            tone={read.avgSentencesPerParagraph <= 3 ? "good" : "warn"}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Flesch Reading Ease over {read.words} words. Syllable counting and
          passive detection are heuristics — read the band, not the decimal.
        </p>
      </section>

      {/* ---------------- Long sentences ---------------- */}
      {read.longSentences.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sentences over {LONG_SENTENCE} words ({read.longSentences.length})
          </h3>
          <ul className="space-y-1.5">
            {read.longSentences.slice(0, 8).map((s) => (
              <li
                key={s.start}
                className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2 text-xs"
              >
                <span className="tabular mr-1.5 font-semibold text-warning">
                  {s.words}w
                </span>
                {s.text.slice(0, 160)}
                {s.text.length > 160 ? "…" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------- Long paragraphs ---------------- */}
      {read.longParagraphs.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Paragraphs over {MAX_PARAGRAPH_SENTENCES} sentences (
            {read.longParagraphs.length})
          </h3>
          <ul className="space-y-1.5">
            {read.longParagraphs.slice(0, 6).map((p) => (
              <li
                key={p.index}
                className="rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground"
              >
                <span className="tabular mr-1.5 font-semibold text-foreground">
                  {p.sentences}
                </span>
                {p.preview}…
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------- Passive voice ---------------- */}
      {read.passive.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Passive constructions ({read.passive.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {read.passive.slice(0, 20).map((p) => (
              <span
                key={`${p.start}-${p.text}`}
                className="rounded bg-muted px-1.5 py-0.5 text-[11px]"
              >
                {p.text}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ---------------- Links ---------------- */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Links ({links.length})
          </h3>
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking || links.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {checking ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Link2 className="size-3.5" aria-hidden />
            )}
            Check links
          </button>
        </div>

        {links.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No links in the draft yet.
          </p>
        )}

        {error !== null && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        {verdicts !== null && (
          <>
            <div
              className={cn(
                "mb-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs",
                unverified !== undefined && unverified.length > 0
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-success/40 bg-success/5",
              )}
            >
              {unverified !== undefined && unverified.length > 0 ? (
                <AlertTriangle
                  className="mt-px size-3.5 shrink-0 text-destructive"
                  aria-hidden
                />
              ) : (
                <Check className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
              )}
              <span>
                {unverified !== undefined && unverified.length > 0
                  ? `${String(unverified.length)} internal link${
                      unverified.length === 1 ? "" : "s"
                    } point at pages that are not in the synced site.`
                  : "Every internal link matches a real page on the site."}
                {indexed !== null &&
                  ` Checked against ${String(indexed)} synced pages.`}
              </span>
            </div>

            <ul className="space-y-1">
              {verdicts.map((v, i) => (
                <li
                  key={`${v.href}-${String(i)}`}
                  className="flex items-start gap-2 rounded px-1.5 py-1 text-xs"
                >
                  {v.kind === "internal" ? (
                    v.status === "verified" ? (
                      <Check className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
                    ) : (
                      <AlertTriangle
                        className="mt-px size-3.5 shrink-0 text-destructive"
                        aria-hidden
                      />
                    )
                  ) : (
                    <ExternalLink
                      className="mt-px size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {v.anchor || v.href}
                    </span>
                    <span className="block truncate text-muted-foreground">
                      {v.href}
                      {v.title !== undefined && ` → ${v.title}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-2 text-[11px] text-muted-foreground">
              External links are listed but not fetched — a site that blocks
              bots would be reported as dead when it is fine in a browser.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
