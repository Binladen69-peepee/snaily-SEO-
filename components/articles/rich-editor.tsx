"use client";

import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import {
  EditorContent,
  ReactNodeViewRenderer,
  useEditor,
  type Editor,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { StarterKit } from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronsDown,
  ChevronsUp,
  Code,
  Code2,
  Columns3,
  Copy,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  Link2Off,
  List,
  ListChecks,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  Quote,
  Redo2,
  Rows3,
  Search,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CommentMark } from "@/components/articles/comment-mark";
import { FindReplace } from "@/components/articles/find-replace";
import { FindReplaceBar } from "@/components/articles/find-replace-bar";
import { ImageBlockView } from "@/components/articles/image-block";
import { LinkDialog } from "@/components/articles/link-dialog";
import { uploadArticleImage } from "@/components/articles/upload-image";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toEditorHtml } from "@/lib/markdown";
import { cn } from "@/lib/utils";

const ArticleImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alt: { default: "" },
      title: { default: null },
      width: { default: null },
      height: { default: null },
      "data-size": { default: "large" },
      "data-align": { default: "center" },
      "data-asset-id": { default: null },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView);
  },
});

const SLASH: { cmd: string; label: string; run: (editor: Editor) => void }[] = [
  {
    cmd: "/heading",
    label: "Heading",
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    cmd: "/image",
    label: "Image",
    run: () => undefined,
  },
  {
    cmd: "/list",
    label: "Bulleted list",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    cmd: "/quote",
    label: "Quote",
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    cmd: "/table",
    label: "Table",
    run: (e) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    cmd: "/todo",
    label: "Task list",
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    cmd: "/divider",
    label: "Divider",
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    cmd: "/faq",
    label: "FAQ",
    run: (e) =>
      e
        .chain()
        .focus()
        .insertContent("<h2>FAQ</h2><h3>Question?</h3><p>Answer.</p>")
        .run(),
  },
  {
    cmd: "/callout",
    label: "Callout",
    run: (e) =>
      e
        .chain()
        .focus()
        .insertContent(
          '<blockquote><p><strong>Tip:</strong> Add the note here.</p></blockquote>',
        )
        .run(),
  },
];

function ToolButton({
  onClick,
  active,
  label,
  children,
  disabled,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
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

function Toolbar({
  editor,
  commentsEnabled,
  onComment,
  onImage,
  onFind,
  onLink,
  variant = "card",
}: {
  editor: Editor;
  commentsEnabled?: boolean;
  onComment?: () => void;
  onImage: () => void;
  onFind: () => void;
  onLink: (current: { href: string; text: string }) => void;
  variant?: "card" | "canvas";
}) {
  const openLink = useCallback(() => {
    const { from, to } = editor.state.selection;
    onLink({
      href: (editor.getAttributes("link").href as string | undefined) ?? "",
      text: editor.state.doc.textBetween(from, to, " ").trim(),
    });
  }, [editor, onLink]);

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-border bg-background",
        variant === "canvas" ? "shrink-0 px-2 py-1 sm:px-3" : "px-1 py-1",
      )}
    >
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

      <select
        aria-label="Paragraph style"
        value={
          editor.isActive("heading", { level: 2 })
            ? "h2"
            : editor.isActive("heading", { level: 3 })
              ? "h3"
              : editor.isActive("heading", { level: 4 })
                ? "h4"
                : "p"
        }
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") editor.chain().focus().setParagraph().run();
          if (v === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
          if (v === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
          if (v === "h4") editor.chain().focus().toggleHeading({ level: 4 }).run();
        }}
        className="h-7 rounded border border-input bg-background px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="p">Paragraph</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
      </select>

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
      <ToolButton
        label="Heading 4"
        active={editor.isActive("heading", { level: 4 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
      >
        <Heading4 className="size-4" />
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
        label="Underline"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-4" />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

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
      <ToolButton
        label="Task list"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListChecks className="size-4" />
      </ToolButton>
      <ToolButton
        label="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="size-4" />
      </ToolButton>
      <ToolButton
        label="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Highlight"
        active={editor.isActive("highlight")}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <Highlighter className="size-4" />
      </ToolButton>
      <ToolButton
        label="Divider"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus className="size-4" />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <ToolButton
        label="Insert table"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        <TableIcon className="size-4" />
      </ToolButton>

      {/* Row and column controls only mean anything with the cursor in a table. */}
      {editor.isActive("table") && (
        <>
          <ToolButton
            label="Add row below"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <Rows3 className="size-4" />
          </ToolButton>
          <ToolButton
            label="Add column after"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <Columns3 className="size-4" />
          </ToolButton>
          <ToolButton
            label="Delete row"
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            <span className="text-[10px] font-bold leading-none">−R</span>
          </ToolButton>
          <ToolButton
            label="Delete column"
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            <span className="text-[10px] font-bold leading-none">−C</span>
          </ToolButton>
          <ToolButton
            label="Toggle header row"
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          >
            <span className="text-[10px] font-bold leading-none">TH</span>
          </ToolButton>
          <ToolButton
            label="Delete table"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <Trash2 className="size-4" />
          </ToolButton>
        </>
      )}

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <ToolButton
        label="Align left"
        active={editor.isActive({ textAlign: "left" })}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <AlignLeft className="size-4" />
      </ToolButton>
      <ToolButton
        label="Align centre"
        active={editor.isActive({ textAlign: "center" })}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <AlignCenter className="size-4" />
      </ToolButton>
      <ToolButton
        label="Align right"
        active={editor.isActive({ textAlign: "right" })}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <AlignRight className="size-4" />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <ToolButton label="Insert link" active={editor.isActive("link")} onClick={openLink}>
        <Link2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Remove link"
        onClick={() => editor.chain().focus().unsetLink().run()}
        disabled={!editor.isActive("link")}
      >
        <Link2Off className="size-4" />
      </ToolButton>
      <ToolButton label="Insert image" onClick={onImage}>
        <ImagePlus className="size-4" />
      </ToolButton>
      <ToolButton label="Find and replace (Ctrl+F)" onClick={onFind}>
        <Search className="size-4" />
      </ToolButton>

      {commentsEnabled && (
        <>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ToolButton label="Add comment" onClick={() => onComment?.()}>
            <MessageSquarePlus className="size-4" />
          </ToolButton>
        </>
      )}
    </div>
  );
}

function moveBlock(editor: Editor, dir: -1 | 1) {
  const { $from } = editor.state.selection;
  const depth = $from.depth;
  if (depth < 1) return;
  const pos = $from.before(1);
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const size = node.nodeSize;
  if (dir === -1) {
    if (pos <= 1) return;
    const prev = editor.state.doc.resolve(pos).nodeBefore;
    if (!prev) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        const slice = tr.doc.slice(pos, pos + size);
        tr.delete(pos, pos + size);
        tr.insert(pos - prev.nodeSize, slice.content);
        return true;
      })
      .run();
  } else {
    const after = pos + size;
    const next = editor.state.doc.resolve(after).nodeAfter;
    if (!next) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        const slice = tr.doc.slice(pos, pos + size);
        tr.delete(pos, pos + size);
        tr.insert(pos + next.nodeSize, slice.content);
        return true;
      })
      .run();
  }
}

function duplicateBlock(editor: Editor) {
  const { $from } = editor.state.selection;
  const pos = $from.before(1);
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor
    .chain()
    .focus()
    .insertContentAt(pos + node.nodeSize, node.toJSON())
    .run();
}

function deleteBlock(editor: Editor) {
  const { $from } = editor.state.selection;
  if ($from.depth < 1) return;
  const pos = $from.before(1);
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
}

export function RichEditor({
  value,
  onChange,
  className,
  commentsEnabled = false,
  onAddComment,
  articleId,
  readOnly = false,
  variant = "card",
  lead,
}: {
  value: string;
  onChange: (html: string) => void;
  className?: string;
  commentsEnabled?: boolean;
  onAddComment?: (quote: string, note: string, id: string) => void;
  articleId?: string;
  readOnly?: boolean;
  /** card = bordered document; canvas = Gutenberg writing surface. */
  variant?: "card" | "canvas";
  /** Rendered above the body in canvas mode (title, suggestions). */
  lead?: ReactNode;
}) {
  const [commenting, setCommenting] = useState<{
    from: number;
    to: number;
    quote: string;
  } | null>(null);
  const [note, setNote] = useState("");
  const [slash, setSlash] = useState<{ query: string; top: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{
    href: string;
    text: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const lastEmitted = useRef(toEditorHtml(value));

  const insertUploaded = useCallback(
    async (ed: Editor, file: File) => {
      if (!articleId) {
        toast.error("Save the article first, then add images.");
        return;
      }
      if (uploading.current) return;
      uploading.current = true;
      try {
        const asset = await uploadArticleImage(articleId, file);
        ed.chain()
          .focus()
          .insertContent({
            type: "image",
            attrs: {
              src: asset.url,
              alt: asset.alt,
              width: asset.width,
              "data-asset-id": asset.id,
              "data-size": "large",
              "data-align": "center",
            },
          })
          .run();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not upload that image.");
      } finally {
        uploading.current = false;
      }
    },
    [articleId],
  );
  const insertUploadedRef = useRef(insertUploaded);
  insertUploadedRef.current = insertUploaded;

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        /*
         * No blanket rel or target.
         *
         * The extension's defaults stamp `target="_blank"` and
         * `rel="noopener noreferrer nofollow"` onto every link it renders,
         * which quietly marked the author's links to their own posts as
         * nofollow. Nulls here are dropped by the serializer rather than
         * written as attributes, and a link that carries its own rel — an
         * affiliate URL marked "sponsored nofollow" by the picker — still
         * renders with it, because mark attributes win over these.
         */
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: null, target: null },
        },
      }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      /*
       * Tables were previously "supported" by a toolbar button that inserted
       * raw <table> HTML with no table extension loaded. ProseMirror validates
       * everything against its schema, so with no table node registered the
       * markup was silently discarded and the button did nothing.
       */
      TableKit.configure({ table: { resizable: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      CharacterCount,
      FindReplace,
      ArticleImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder: "Write the post. Type / for blocks, or drop an image in.",
      }),
      CommentMark,
    ],
    content: toEditorHtml(value),
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      lastEmitted.current = html;
      onChange(html);
      const { $from } = e.state.selection;
      const text = $from.parent.textContent;
      if (text.startsWith("/") && $from.parentOffset === text.length) {
        setSlash({ query: text, top: 0 });
      } else {
        setSlash(null);
      }
    },
    onCreate: ({ editor: created }) => {
      editorRef.current = created;
    },
    editorProps: {
      attributes: {
        class:
          variant === "canvas"
            ? "prose-editor cs-post cs-canvas min-h-[16rem] focus:outline-none"
            : "prose-editor cs-post min-h-[24rem] focus:outline-none xl:min-h-[32rem]",
        "aria-label": "Article content",
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const image = [...files].find((f) => f.type.startsWith("image/"));
        const ed = editorRef.current;
        if (!image || !ed) return false;
        event.preventDefault();
        void insertUploadedRef.current(ed, image);
        return true;
      },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files || files.length === 0) return false;
        const image = [...files].find((f) => f.type.startsWith("image/"));
        const ed = editorRef.current;
        if (!image || !ed) return false;
        event.preventDefault();
        void insertUploadedRef.current(ed, image);
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = toEditorHtml(value);
    if (next === lastEmitted.current || next === editor.getHTML()) return;
    lastEmitted.current = next;
    queueMicrotask(() => {
      if (!editor.isDestroyed && next !== editor.getHTML()) {
        editor.commands.setContent(next, { emitUpdate: false });
      }
    });
  }, [value, editor]);

  useEffect(() => {
    editorRef.current = editor;
    if (editor) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  /*
   * Ctrl/Cmd+F opens our find bar instead of the browser's. The browser's
   * cannot see past the visible viewport of a long document and cannot
   * replace, so intercepting it is the more useful behaviour — Escape in the
   * bar closes it and hands the key back.
   */
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        const editorEl = editorRef.current?.view.dom;
        // Only when the caret is actually in this editor, so Ctrl+F elsewhere
        // on the page still belongs to the browser.
        if (editorEl?.contains(document.activeElement) === true) {
          e.preventDefault();
          setFindOpen(true);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [readOnly]);

  if (!editor) {
    return (
      <div className={cn("min-h-[24rem] animate-pulse rounded bg-muted/40", className)} />
    );
  }

  function beginComment() {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) return;
    const quote = editor.state.doc.textBetween(from, to, " ").trim();
    if (quote === "") return;
    setCommenting({ from, to, quote });
    setNote("");
  }

  function saveComment() {
    if (!editor || commenting === null || note.trim() === "") return;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `c-${String(Date.now())}`;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: commenting.from, to: commenting.to })
      .setMark("comment", { id, note: note.trim() })
      .run();
    onAddComment?.(commenting.quote, note.trim(), id);
    setCommenting(null);
    setNote("");
  }

  const slashHits = slash
    ? SLASH.filter((s) => s.cmd.startsWith(slash.query.toLowerCase()) || slash.query === "/")
    : [];

  const body = (
    <>
      {variant !== "canvas" && !readOnly && (
        <div className="absolute top-3 left-1 z-10 hidden flex-col gap-0.5 sm:flex">
          <button
            type="button"
            title="Move block up"
            aria-label="Move block up"
            onClick={() => {
              moveBlock(editor, -1);
            }}
            className="rounded p-0.5 text-muted-foreground/50 hover:bg-accent hover:text-foreground"
          >
            <ChevronsUp className="size-3.5" />
          </button>
          <button
            type="button"
            title="Move block down"
            aria-label="Move block down"
            onClick={() => {
              moveBlock(editor, 1);
            }}
            className="rounded p-0.5 text-muted-foreground/50 hover:bg-accent hover:text-foreground"
          >
            <ChevronsDown className="size-3.5" />
          </button>
          <button
            type="button"
            title="Duplicate block"
            aria-label="Duplicate block"
            onClick={() => {
              duplicateBlock(editor);
            }}
            className="rounded p-0.5 text-muted-foreground/50 hover:bg-accent hover:text-foreground"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            title="Delete block"
            aria-label="Delete block"
            onClick={() => {
              deleteBlock(editor);
            }}
            className="rounded p-0.5 text-muted-foreground/50 hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
      {!readOnly && (
        /*
         * Selection toolbar, the way WordPress does it: highlight a phrase and
         * the link control is right there. Linking used to mean reaching for
         * the toolbar at the top of a long post, which is why so few links got
         * added by hand.
         */
        <BubbleMenu
          editor={editor}
          options={{ placement: "top", offset: 8 }}
          shouldShow={({ editor: e, from, to }: { editor: Editor; from: number; to: number }) => {
            if (e.isActive("image")) return false;
            return to > from && e.state.doc.textBetween(from, to, " ").trim() !== "";
          }}
          className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          <button
            type="button"
            title="Insert link"
            aria-label="Insert link"
            onClick={() => {
              const { from, to } = editor.state.selection;
              setLinkDialog({
                href: (editor.getAttributes("link").href as string | undefined) ?? "",
                text: editor.state.doc.textBetween(from, to, " ").trim(),
              });
            }}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-accent",
              editor.isActive("link") && "bg-accent",
            )}
          >
            <Link2 className="size-3.5" aria-hidden />
            Link
          </button>
          {editor.isActive("link") && (
            <button
              type="button"
              title="Remove link"
              aria-label="Remove link"
              onClick={() => editor.chain().focus().unsetLink().run()}
              className="rounded p-1.5 hover:bg-accent"
            >
              <Link2Off className="size-3.5" aria-hidden />
            </button>
          )}
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <button
            type="button"
            title="Bold"
            aria-label="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={cn(
              "rounded p-1.5 hover:bg-accent",
              editor.isActive("bold") && "bg-accent",
            )}
          >
            <Bold className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            title="Italic"
            aria-label="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={cn(
              "rounded p-1.5 hover:bg-accent",
              editor.isActive("italic") && "bg-accent",
            )}
          >
            <Italic className="size-3.5" aria-hidden />
          </button>
          {commentsEnabled && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
              <button
                type="button"
                title="Add comment"
                aria-label="Add comment"
                onClick={beginComment}
                className="rounded p-1.5 hover:bg-accent"
              >
                <MessageSquarePlus className="size-3.5" aria-hidden />
              </button>
            </>
          )}
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
      {slash && slashHits.length > 0 && (
        <ul
          className={cn(
            "absolute z-20 mt-1 w-52 overflow-hidden rounded-md border border-border bg-card py-1 text-sm shadow-lg",
            variant === "canvas" ? "left-0" : "left-8",
          )}
        >
          {slashHits.map((s) => (
            <li key={s.cmd}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().deleteRange({
                    from: editor.state.selection.from - slash.query.length,
                    to: editor.state.selection.from,
                  }).run();
                  if (s.cmd === "/image") {
                    fileRef.current?.click();
                  } else {
                    s.run(editor);
                  }
                  setSlash(null);
                }}
              >
                <span>{s.label}</span>
                <span className="text-xs text-muted-foreground">{s.cmd}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div
      className={cn(
        variant === "canvas"
          ? "flex min-h-0 flex-1 flex-col bg-background"
          : "overflow-hidden rounded-xl border border-border bg-background shadow-sm",
        className,
      )}
    >
      {!readOnly && (
        <Toolbar
          editor={editor}
          commentsEnabled={commentsEnabled}
          onComment={beginComment}
          onImage={() => fileRef.current?.click()}
          onFind={() => {
            setFindOpen(true);
          }}
          onLink={setLinkDialog}
          variant={variant}
        />
      )}
      {!readOnly && findOpen && (
        <FindReplaceBar
          editor={editor}
          onClose={() => {
            setFindOpen(false);
            editor.commands.focus();
          }}
        />
      )}
      {linkDialog !== null && (
        <LinkDialog
          articleId={articleId}
          initialHref={linkDialog.href}
          selectedText={linkDialog.text}
          onApply={({ href, rel, target }) => {
            // Only http(s) and site-relative paths. Anything else — javascript:,
            // data: — would become a live link on the published post.
            if (!/^https?:\/\//i.test(href) && !href.startsWith("/")) {
              toast.error("Links must be an http(s) URL or a site path.");
              return;
            }
            /*
             * `rel` is set by the picker, not chosen here: an affiliate URL
             * carries "sponsored nofollow" and a link to one of the author's
             * own posts deliberately carries neither, so it keeps its equity.
             */
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href, rel: rel ?? null, target: target ?? null })
              .run();
            setLinkDialog(null);
          }}
          onRemove={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            setLinkDialog(null);
          }}
          onClose={() => {
            setLinkDialog(null);
          }}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void insertUploaded(editor, file);
        }}
      />
      {variant === "canvas" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[42rem] px-5 pt-6 pb-16 sm:px-8">
            {lead}
            <div className="relative py-1">{body}</div>
            {commentsEnabled && commenting !== null && (
              <div className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Comment on “{commenting.quote.slice(0, 120)}
                  {commenting.quote.length > 120 ? "…" : ""}”
                </p>
                <Textarea
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                  placeholder="What should the 2nd draft do with this?"
                  rows={3}
                  className="mt-2"
                  autoFocus
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCommenting(null);
                      setNote("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={note.trim() === ""}
                    onClick={saveComment}
                  >
                    Add comment
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="relative px-4 py-5 sm:px-8 sm:py-8">{body}</div>
          {commentsEnabled && commenting !== null && (
            <div className="border-t border-border bg-muted/30 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                Comment on “{commenting.quote.slice(0, 120)}
                {commenting.quote.length > 120 ? "…" : ""}”
              </p>
              <Textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
                placeholder="What should the 2nd draft do with this?"
                rows={3}
                className="mt-2"
                autoFocus
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCommenting(null);
                    setNote("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={note.trim() === ""}
                  onClick={saveComment}
                >
                  Add comment
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
