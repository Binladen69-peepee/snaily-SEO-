"use client";

import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  Minus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The WordPress export preview.
 *
 * Everything shown here comes from a dry run of the real export on the server,
 * so the author is confirming the draft that will actually be created rather
 * than a description of one. Nothing has been written to the site until they
 * press the button at the bottom.
 */

export type ExportPreview = {
  template: { wpId: number; title: string; status: string; configured: boolean };
  sections: {
    key: string;
    label: string;
    inTemplate: boolean;
    inArticle: boolean;
    blocksWritten: number;
    note?: string;
  }[];
  steps: { mapped: number; slots: number; added: number; removed: number };
  faqs: number;
  internalLinks: { anchor: string; url: string }[];
  unresolvedInternal: { anchor: string; href: string }[];
  affiliateLinks: { term: string; kind: string; host: string }[];
  relatedPosts: { wpId: number; title: string }[];
  imagesSkipped: number;
  recipeCardPreserved: boolean;
  unmapped: { heading: string; words: number }[];
  unknownTemplateHeadings: string[];
  needsReview: boolean;
  updating: boolean;
  seo: {
    title: string;
    description: string;
    slug: string;
    excerpt: string;
    categories: string[];
    tags: string[];
  };
  status: "draft";
};

export type ExportOutcome = {
  id: number;
  url: string;
  updated: boolean;
  record: {
    templatePostId: number;
    templateTitle: string;
    draftId: number;
    editLink: string;
    sectionsPopulated: number;
    stepsMapped: number;
    faqsMapped: number;
    internalLinks: number;
    affiliateLinks: number;
    imagesSkipped: number;
    needsReview: boolean;
    at: string;
  };
} & ExportPreview;

type ExportError = {
  error?: string;
  reason?: string;
  setupIncomplete?: boolean;
};

type Props = {
  articleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True when a draft already exists and this send should update it. */
  update: boolean;
  /** Handles the reasons that need the setup gate rather than a message here. */
  onGate: (reason: string) => void;
  onExported: (result: ExportOutcome) => void;
};

function Row({
  state,
  label,
  detail,
}: {
  state: "ok" | "warn" | "skip";
  label: string;
  detail?: string;
}) {
  const Icon = state === "ok" ? Check : state === "warn" ? AlertTriangle : Minus;
  const tone =
    state === "ok"
      ? "text-success"
      : state === "warn"
        ? "text-warning"
        : "text-muted-foreground";

  return (
    <li className="flex items-start gap-2 py-1 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
      <span className="min-w-0">
        <span className="break-words">{label}</span>
        {detail !== undefined && detail !== "" ? (
          <span className="block text-xs text-muted-foreground break-words">
            {detail}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function WordPressExportDialog({
  articleId,
  open,
  onOpenChange,
  update,
  onGate,
  onExported,
}: Props) {
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [result, setResult] = useState<ExportOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/articles/${articleId}/export?update=${update ? "1" : "0"}`,
      );
      const data = (await res.json()) as ExportPreview & ExportError;

      if (!res.ok) {
        if (
          data.setupIncomplete === true ||
          data.reason === "not_configured" ||
          data.reason === "connection_lost" ||
          data.reason === "route_missing"
        ) {
          onOpenChange(false);
          onGate(data.reason ?? "not_configured");
          return;
        }
        setError(data.error ?? "Could not build the export preview.");
        return;
      }

      setPreview(data);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [articleId, update, onGate, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    void load();
  }, [open, load]);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dest: "wordpress", update }),
      });
      const data = (await res.json()) as ExportOutcome & ExportError;

      if (!res.ok) {
        if (
          data.setupIncomplete === true ||
          data.reason === "not_configured" ||
          data.reason === "connection_lost" ||
          data.reason === "route_missing"
        ) {
          onOpenChange(false);
          onGate(data.reason ?? "not_configured");
          return;
        }
        // A failed export never reports success, and never leaves the dialog
        // looking as though something was created.
        toast.error(data.error ?? "Could not create the WordPress draft.");
        setError(data.error ?? "Could not create the WordPress draft.");
        return;
      }

      setResult(data);
      onExported(data);

      /*
       * Straight to the draft in WordPress, which is where the work continues:
       * photos, alt text and the recipe card all happen there. A new tab
       * rather than a redirect, so the editor and any unsaved change in it
       * survive. If the browser blocks the popup the result panel behind this
       * still carries the link, so the draft is never unreachable.
       */
      const opened =
        data.url === ""
          ? null
          : window.open(data.url, "_blank", "noopener,noreferrer");

      toast.success(
        data.updated ? "WordPress draft updated" : "WordPress draft created",
        opened === null && data.url !== ""
          ? {
              action: {
                label: "Open in WordPress",
                onClick: () => {
                  window.location.href = data.url;
                },
              },
            }
          : undefined,
      );
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  const p = result ?? preview;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {result ? "WordPress draft created" : "WordPress export preview"}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Saved as a draft. Nothing has been published."
              : "This duplicates your Blog Post Template and saves the copy as a draft. It never publishes."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Mapping the draft into your template…
          </p>
        ) : error !== null && p === null ? (
          <p className="flex items-start gap-2 py-6 text-sm text-warning">
            <X className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : p === null ? null : (
          <div className="space-y-4">
            {result ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border p-3 text-sm">
                <dt className="text-muted-foreground">Draft ID</dt>
                <dd className="font-medium">#{result.id}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">Draft</dd>
                <dt className="text-muted-foreground">From template</dt>
                <dd className="break-words">
                  {p.template.title} (#{p.template.wpId})
                </dd>
                <dt className="text-muted-foreground">Last synced</dt>
                <dd>{new Date(result.record.at).toLocaleString()}</dd>
              </dl>
            ) : null}

            <ul className="divide-y divide-border">
              <Row
                state="ok"
                label={`Template selected — ${p.template.title} (#${p.template.wpId})`}
                detail={
                  p.template.configured
                    ? undefined
                    : "Detected automatically. Pick it explicitly in project settings to pin it."
                }
              />
              <Row
                state="ok"
                label={result ? "Template duplicated" : "Template will be duplicated"}
                detail="The original template post is never edited."
              />
              <Row state="ok" label="Title populated" />
              <Row
                state={
                  p.sections.filter((s) => s.blocksWritten > 0).length > 0 ? "ok" : "warn"
                }
                label={`${String(p.sections.filter((s) => s.blocksWritten > 0).length)} of ${String(p.sections.length)} template sections populated`}
                detail={p.sections
                  .filter((s) => s.blocksWritten > 0)
                  .map((s) => s.label)
                  .join(", ")}
              />
              <Row
                state={p.steps.mapped > 0 ? "ok" : "warn"}
                label={`${String(p.steps.mapped)} steps mapped into the step grid`}
                detail={
                  p.steps.added > 0
                    ? `${String(p.steps.added)} extra step column(s) cloned from the template.`
                    : p.steps.removed > 0
                      ? `${String(p.steps.removed)} unused step column(s) removed.`
                      : undefined
                }
              />
              <Row
                state={p.faqs > 0 ? "ok" : "skip"}
                label={
                  p.faqs > 0
                    ? `${String(p.faqs)} FAQs written into the Yoast block`
                    : "No FAQs in this draft"
                }
              />
              <Row
                state={p.internalLinks.length > 0 ? "ok" : "skip"}
                label={`${String(p.internalLinks.length)} internal links resolved`}
                detail={
                  p.unresolvedInternal.length > 0
                    ? `${String(p.unresolvedInternal.length)} could not be verified and were left as plain text: ${p.unresolvedInternal
                        .map((u) => u.anchor)
                        .slice(0, 4)
                        .join(", ")}`
                    : undefined
                }
              />
              <Row
                state={p.affiliateLinks.length > 0 ? "ok" : "skip"}
                label={`${String(p.affiliateLinks.length)} ingredient links resolved`}
                detail={
                  p.affiliateLinks.length > 0
                    ? p.affiliateLinks.map((a) => a.term).join(", ")
                    : "No ingredient in this draft matched your sheet, so nothing was linked."
                }
              />
              <Row
                state={p.relatedPosts.length > 0 ? "ok" : "skip"}
                label={
                  p.relatedPosts.length > 0
                    ? `${String(p.relatedPosts.length)} related recipes in the Feast grid`
                    : "No related recipes matched a published post"
                }
                detail={p.relatedPosts.map((r) => r.title).join(", ")}
              />
              <Row
                state={
                  p.seo.title.trim() !== "" || p.seo.description.trim() !== ""
                    ? "ok"
                    : "skip"
                }
                label="SEO metadata"
                detail={
                  p.seo.title.trim() === "" && p.seo.description.trim() === ""
                    ? "No SEO title or description set — WordPress keeps its own."
                    : [p.seo.title, p.seo.slug].filter((s) => s !== "").join(" · ")
                }
              />
              <Row
                state="ok"
                label="Images left for your WordPress workflow"
                detail={
                  p.imagesSkipped > 0
                    ? `${String(p.imagesSkipped)} image(s) in the draft were not uploaded. The template's own image placeholders are preserved.`
                    : "Nothing is uploaded to your media library. The template's image placeholders are preserved."
                }
              />
              {p.recipeCardPreserved ? (
                <Row
                  state="ok"
                  label="Recipe card block preserved"
                  detail="WP Recipe Maker is untouched — create the card in WordPress as you do today."
                />
              ) : null}
              <Row
                state="ok"
                label="Status = Draft"
                detail="The connector cannot publish or schedule, whatever it is asked to do."
              />
            </ul>

            {p.needsReview ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-warning">
                  <AlertTriangle className="size-4" aria-hidden />
                  Section mapping requires review
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {p.unmapped.map((u) => (
                    <li key={u.heading}>
                      &ldquo;{u.heading}&rdquo; ({u.words} words) has no matching
                      template section, so it was not placed.
                    </li>
                  ))}
                  {p.sections
                    .filter((s) => s.note?.startsWith("Section mapping requires review"))
                    .map((s) => (
                      <li key={s.key}>
                        {s.label}: {s.note}
                      </li>
                    ))}
                  {p.unknownTemplateHeadings.map((h) => (
                    <li key={h}>
                      Template heading &ldquo;{h}&rdquo; was not recognised and was left
                      empty.
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button asChild>
                <a href={result.url} target="_blank" rel="noreferrer">
                  Open WordPress draft
                  <ExternalLink className="ml-1.5 size-3.5" aria-hidden />
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={preview === null || sending || loading} onClick={() => void send()}>
                {sending ? (
                  <>
                    <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
                    Creating…
                  </>
                ) : preview?.updating === true ? (
                  "Update WordPress draft"
                ) : (
                  "Create WordPress draft"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
