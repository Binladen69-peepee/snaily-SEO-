import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/**
 * Find and replace.
 *
 * Tiptap ships no such extension, so this is a ProseMirror plugin: it walks
 * the document's text nodes, records every match as a document range, and
 * paints them with decorations. Decorations are display-only — they never
 * enter the document — so searching cannot alter the draft, and clearing the
 * search leaves nothing behind to undo.
 *
 * Replacements go through a single transaction applied back-to-front, because
 * replacing a match shifts every position after it.
 */

export const findReplaceKey = new PluginKey<FindState>("findReplace");

export type FindMatch = { from: number; to: number };

export type FindState = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  matches: FindMatch[];
  /** Index into `matches`, or -1 when there are none. */
  active: number;
  decorations: DecorationSet;
};

const EMPTY: FindState = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  matches: [],
  active: -1,
  decorations: DecorationSet.empty,
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every match in the document, as absolute positions.
 *
 * Text is gathered per text node rather than from `doc.textBetween`, so a
 * match position maps straight back to a document position without having to
 * reverse-engineer the block separators that textBetween inserts.
 */
function findMatches(
  doc: EditorState["doc"],
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): FindMatch[] {
  if (query.trim() === "") return [];

  const pattern = wholeWord
    ? `\\b${escapeRegExp(query)}\\b`
    : escapeRegExp(query);

  let re: RegExp;
  try {
    re = new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch {
    return [];
  }

  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || node.text === null || node.text === undefined) return;
    const text = node.text;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // A zero-length match would loop forever and select nothing.
      if (m[0] === "") {
        re.lastIndex += 1;
        continue;
      }
      matches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
    }
  });

  return matches;
}

function decorate(matches: FindMatch[], active: number, doc: EditorState["doc"]) {
  if (matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === active ? "find-match find-match-active" : "find-match",
      }),
    ),
  );
}

type FindMeta =
  | { type: "search"; query: string; caseSensitive: boolean; wholeWord: boolean }
  | { type: "step"; delta: 1 | -1 }
  | { type: "clear" };

export const FindReplace = Extension.create({
  name: "findReplace",

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findReplaceKey,
        state: {
          init: () => EMPTY,
          apply(tr: Transaction, prev: FindState): FindState {
            const meta = tr.getMeta(findReplaceKey) as FindMeta | undefined;

            if (meta?.type === "clear") return EMPTY;

            if (meta?.type === "search") {
              const matches = findMatches(
                tr.doc,
                meta.query,
                meta.caseSensitive,
                meta.wholeWord,
              );
              const active = matches.length === 0 ? -1 : 0;
              return {
                query: meta.query,
                caseSensitive: meta.caseSensitive,
                wholeWord: meta.wholeWord,
                matches,
                active,
                decorations: decorate(matches, active, tr.doc),
              };
            }

            if (meta?.type === "step" && prev.matches.length > 0) {
              const active =
                (prev.active + meta.delta + prev.matches.length) %
                prev.matches.length;
              return {
                ...prev,
                active,
                decorations: decorate(prev.matches, active, tr.doc),
              };
            }

            if (prev.query === "") return prev;

            // The document changed under us — re-run rather than trying to map
            // stale ranges, which drift as soon as a replacement resizes text.
            if (tr.docChanged) {
              const matches = findMatches(
                tr.doc,
                prev.query,
                prev.caseSensitive,
                prev.wholeWord,
              );
              const active =
                matches.length === 0
                  ? -1
                  : Math.min(Math.max(prev.active, 0), matches.length - 1);
              return {
                ...prev,
                matches,
                active,
                decorations: decorate(matches, active, tr.doc),
              };
            }

            return prev;
          },
        },
        props: {
          decorations: (state) => findReplaceKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});

export function getFindState(state: EditorState): FindState {
  return findReplaceKey.getState(state) ?? EMPTY;
}
