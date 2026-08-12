"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  AlertTriangle,
  Bold,
  Check,
  ClipboardCheck,
  Copy,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, MOMENT_LABEL } from "@/lib/geo/config";
import type { GeoIdeaView } from "@/lib/geo/idea";
import { cn } from "@/lib/utils";

export type DraftIdea = GeoIdeaView;

/* -------------------------------------------------------------------------
 * Toolbar
 *
 * Deliberately narrower than the article editor's: colour, fonts and
 * alignment all emit style attributes, and the export target is the
 * WordPress block editor, which should inherit the theme's own typography.
 * ---------------------------------------------------------------------- */

function ToolButton({
  onClick,
  active,
  label,
  disabled,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "rounded p-1.5 transition-colors disabled:opacity-40",
        active
          ? "bg-primary/12 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;

    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!/^https?:\/\//i.test(url.trim())) {
      window.alert("Links must be an http(s) URL.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5">
      <ToolButton
        label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo2 className="size-4" />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <ToolButton
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="size-4" />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <ToolButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-4" />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" />
      </ToolButton>
      <ToolButton
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-4" />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <ToolButton label="Insert link" active={editor.isActive("link")} onClick={setLink}>
        <Link2 className="size-4" />
      </ToolButton>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * WordPress export
 * ---------------------------------------------------------------------- */

/**
 * Mirrors the server's `cleanHtml` for whatever the human typed in the editor.
 *
 * The paste target is the WP block editor, so the export carries no classes,
 * no inline styles, no app markup and no relative or placeholder links.
 */
const WP_TAGS = new Set([
  "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "a", "blockquote", "br",
]);

export function toWordPressHtml(html: string): string {
  let out = html
    .replace(/<\/?(?:html|head|body|main|article|section|div|span|figure)[^>]*>/gi, "")
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");

  out = out.replace(/<([a-z0-9]+)((?:\s+[^>]*)?)>/gi, (_m, tag: string, attrs: string) => {
    const name = tag.toLowerCase();
    if (!WP_TAGS.has(name)) return "";
    if (name === "a") {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
      if (!/^https?:\/\//i.test(href)) return "";
      return `<a href="${href}">`;
    }
    return `<${name}>`;
  });

  out = out.replace(/<\/([a-z0-9]+)>/gi, (_m, tag: string) =>
    WP_TAGS.has(tag.toLowerCase()) ? `</${tag.toLowerCase()}>` : "",
  );

  // One block per line so the WP editor splits it into blocks cleanly.
  return out
    .replace(/></g, ">\n<")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/* -------------------------------------------------------------------------
 * Panel
 * ---------------------------------------------------------------------- */

export function DraftEditor({
  idea,
  onClose,
  onSaved,
}: {
  idea: DraftIdea;
  onClose: () => void;
  onSaved: (idea: DraftIdea) => void;
}) {
  const [html, setHtml] = useState(idea.draftHtml);
  const [metaTitle, setMetaTitle] = useState(idea.metaTitle);
  const [metaDescription, setMetaDescription] = useState(idea.metaDescription);
  const [slug, setSlug] = useState(idea.slug);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dirty, setDirty] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: false },
      }),
    ],
    content: idea.draftHtml,
    onUpdate: ({ editor: e }) => {
      setHtml(e.getHTML());
      setDirty(true);
    },
    editorProps: {
      attributes: {
        class: "prose-editor min-h-80 focus:outline-none",
        "aria-label": "Draft body",
      },
    },
  });

  // A regenerate replaces the body from outside the editor.
  useEffect(() => {
    if (!editor) return;
    if (idea.draftHtml !== editor.getHTML()) {
      editor.commands.setContent(idea.draftHtml, { emitUpdate: false });
      setHtml(idea.draftHtml);
      setDirty(false);
    }
  }, [idea.draftHtml, editor]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/geo/idea/${idea.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftHtml: html,
          metaTitle,
          metaDescription,
          slug,
        }),
      });
      const data = (await res.json()) as { idea?: DraftIdea; error?: string };
      if (!res.ok || !data.idea) {
        toast.error(data.error ?? "Could not save");
        return;
      }
      onSaved(data.idea);
      setDirty(false);
      toast.success("Draft saved");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  async function copyForWordPress() {
    const body = toWordPressHtml(html);
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
      toast.success("WordPress-ready HTML copied");
    } catch {
      toast.error("Clipboard blocked — copy from the HTML box below instead");
    }
  }

  const titleLen = metaTitle.length;
  const descLen = metaDescription.length;

  return (
    <section
      className="rounded-lg border border-border bg-card"
      aria-label={`Draft: ${idea.title}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-snug">{idea.title}</h2>
          {/* Which moment this draft came from — the spec asks for it to stay visible. */}
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded bg-primary/12 px-1.5 py-0.5 font-medium text-primary">
              {MOMENT_LABEL[idea.moment] ?? idea.moment}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5">
              {CATEGORY_LABEL[idea.category] ?? idea.category}
            </span>
            <span className="min-w-0">{idea.rationale}</span>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close draft">
          <X />
        </Button>
      </header>

      {idea.qaNotes !== null && idea.qaNotes !== "" && (
        <div className="border-b border-warning/40 bg-warning/5 px-4 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            Check before publishing
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            {idea.qaNotes.split("\n").map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-border">
          {editor ? (
            <>
              <Toolbar editor={editor} />
              <div className="px-3 py-3 sm:px-4">
                <EditorContent editor={editor} />
              </div>
            </>
          ) : (
            <div className="min-h-80 animate-pulse bg-muted/40" />
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`meta-title-${idea.id}`}>Title tag</Label>
            <Input
              id={`meta-title-${idea.id}`}
              value={metaTitle}
              onChange={(e) => {
                setMetaTitle(e.target.value);
                setDirty(true);
              }}
              className="h-9"
            />
            <p
              className={cn(
                "text-[11px]",
                titleLen > 60 ? "text-warning" : "text-muted-foreground",
              )}
            >
              {titleLen} characters · 50–60 is the safe range
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`meta-desc-${idea.id}`}>Meta description</Label>
            <Textarea
              id={`meta-desc-${idea.id}`}
              rows={3}
              value={metaDescription}
              onChange={(e) => {
                setMetaDescription(e.target.value);
                setDirty(true);
              }}
            />
            <p
              className={cn(
                "text-[11px]",
                descLen > 160 ? "text-warning" : "text-muted-foreground",
              )}
            >
              {descLen} characters · 140–160 is the safe range
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`slug-${idea.id}`}>Slug</Label>
            <Input
              id={`slug-${idea.id}`}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setDirty(true);
              }}
              className="h-9 font-mono text-xs"
            />
          </div>

          {(idea.faq ?? []).length > 0 && (
            <div>
              <p className="text-xs font-medium">
                FAQ ({(idea.faq ?? []).length}) — from real observed questions
              </p>
              <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                {(idea.faq ?? []).map((f) => (
                  <li key={f.question}>• {f.question}</li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Already included at the end of the body.
              </p>
            </div>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
          {dirty ? "Save changes" : "Saved"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copyForWordPress()}
        >
          {copied ? <ClipboardCheck /> : <Copy />}
          Copy for WordPress
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Nothing publishes automatically — review, then paste into WordPress.
        </span>
      </footer>

      <details className="border-t border-border px-4 py-2.5">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          View the exported HTML
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded border border-border bg-muted/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word">
          {toWordPressHtml(html)}
        </pre>
      </details>
    </section>
  );
}
