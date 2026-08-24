import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Highlight a span the author has commented on.
 *
 * The note lives on the mark so it survives copy/paste inside the editor, and
 * is also stored on the article row for the redraft prompt.
 */
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs) =>
          attrs.id ? { "data-comment-id": String(attrs.id) } : {},
      },
      note: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-comment-note") ?? "",
        renderHTML: (attrs) =>
          typeof attrs.note === "string" && attrs.note !== ""
            ? { "data-comment-note": attrs.note }
            : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "comment-mark" }),
      0,
    ];
  },
});
