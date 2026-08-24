"use client";

import type { Editor } from "@tiptap/react";
import { ArrowDown, ArrowUp, Replace, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  findReplaceKey,
  getFindState,
  type FindMatch,
} from "@/components/articles/find-replace";
import { cn } from "@/lib/utils";

/**
 * Find and replace bar.
 *
 * Sits above the editor rather than floating over it, so it never covers the
 * line you are searching for — the failure that makes most in-page find bars
 * annoying in a long document.
 */
export function FindReplaceBar({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [state, setState] = useState({ count: 0, active: -1 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const sync = useCallback(() => {
    const s = getFindState(editor.state);
    setState({ count: s.matches.length, active: s.active });
  }, [editor]);

  // Re-run the search whenever the query or its options change.
  useEffect(() => {
    const tr = editor.state.tr.setMeta(findReplaceKey, {
      type: "search",
      query,
      caseSensitive,
      wholeWord,
    });
    editor.view.dispatch(tr);
    sync();
  }, [query, caseSensitive, wholeWord, editor, sync]);

  // Clearing on unmount matters: the decorations would otherwise stay painted
  // over the document after the bar is gone.
  useEffect(() => {
    return () => {
      if (editor.isDestroyed) return;
      editor.view.dispatch(
        editor.state.tr.setMeta(findReplaceKey, { type: "clear" }),
      );
    };
  }, [editor]);

  const scrollToActive = useCallback(() => {
    const s = getFindState(editor.state);
    const match = s.matches[s.active];
    if (match === undefined) return;
    editor.commands.setTextSelection({ from: match.from, to: match.to });
    editor.commands.scrollIntoView();
  }, [editor]);

  function step(delta: 1 | -1) {
    editor.view.dispatch(
      editor.state.tr.setMeta(findReplaceKey, { type: "step", delta }),
    );
    sync();
    scrollToActive();
  }

  function replaceOne() {
    const s = getFindState(editor.state);
    const match = s.matches[s.active];
    if (match === undefined) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: match.from, to: match.to }, replacement)
      .run();
    sync();
  }

  function replaceAll() {
    const s = getFindState(editor.state);
    if (s.matches.length === 0) return;

    /*
     * Applied back to front in one transaction. Replacing front to back would
     * shift every later match by the length difference, so each subsequent
     * range would land in the wrong place — and one transaction means one undo
     * step rather than hundreds.
     */
    const { tr } = editor.state;
    const ordered = [...s.matches].sort((a: FindMatch, b: FindMatch) => b.from - a.from);
    for (const m of ordered) {
      tr.replaceWith(
        m.from,
        m.to,
        replacement === "" ? [] : editor.schema.text(replacement),
      );
    }
    editor.view.dispatch(tr);
    sync();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  }

  const field =
    "h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const iconBtn =
    "inline-flex size-8 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40";

  return (
    <div
      className="flex flex-col gap-2 border-b border-border bg-muted/40 px-2 py-2 sm:px-3"
      onKeyDown={onKeyDown}
      role="search"
      aria-label="Find and replace"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Find in post"
          aria-label="Find"
          className={cn(field, "sm:max-w-64")}
        />

        <span
          className="tabular shrink-0 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {query === ""
            ? "—"
            : state.count === 0
              ? "No matches"
              : `${String(state.active + 1)} of ${String(state.count)}`}
        </span>

        <button
          type="button"
          onClick={() => {
            step(-1);
          }}
          disabled={state.count === 0}
          aria-label="Previous match"
          className={iconBtn}
        >
          <ArrowUp className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            step(1);
          }}
          disabled={state.count === 0}
          aria-label="Next match"
          className={iconBtn}
        >
          <ArrowDown className="size-4" />
        </button>

        <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => {
              setCaseSensitive(e.target.checked);
            }}
          />
          Aa
        </label>
        <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => {
              setWholeWord(e.target.checked);
            }}
          />
          Whole word
        </label>

        <button
          type="button"
          onClick={() => {
            setShowReplace((v) => !v);
          }}
          aria-expanded={showReplace}
          aria-label="Toggle replace"
          className={iconBtn}
        >
          <Replace className="size-4" />
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close find"
          className={cn(iconBtn, "ml-auto")}
        >
          <X className="size-4" />
        </button>
      </div>

      {showReplace && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value);
            }}
            placeholder="Replace with"
            aria-label="Replace with"
            className={cn(field, "sm:max-w-64")}
          />
          <button
            type="button"
            onClick={replaceOne}
            disabled={state.count === 0}
            className="h-8 shrink-0 rounded border border-input px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={replaceAll}
            disabled={state.count === 0}
            className="h-8 shrink-0 rounded border border-input px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
          >
            Replace all ({String(state.count)})
          </button>
        </div>
      )}
    </div>
  );
}
