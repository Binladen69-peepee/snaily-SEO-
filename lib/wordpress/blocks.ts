/**
 * Gutenberg block parser and serialiser.
 *
 * The Cinnamon Snail export duplicates the client's real "Blog Post Template"
 * post rather than generating markup from scratch, so the template's block
 * tree has to survive the round trip byte for byte: the `wp:group` wrappers,
 * the `feast-top-tip` class names, the `numpic turn2` step images that the
 * theme's CSS numbers, the Feast and WP Recipe Maker blocks. Anything this
 * file does not deliberately change must come out exactly as it went in.
 *
 * That rules out regex surgery on the markup. The grammar is WordPress's own
 * (`class-wp-block-parser.php`), and the tree keeps `innerContent` in the same
 * shape core uses — a list of literal HTML chunks with `null` marking where
 * each child block sits — so serialising an untouched tree reproduces the
 * original string.
 *
 * Attribute JSON is kept as the raw source text and re-emitted verbatim unless
 * a caller actually edits it. WordPress writes attributes with PHP's
 * `wp_json_encode` (escaped unicode, escaped slashes), which `JSON.stringify`
 * does not reproduce, so re-encoding an untouched block would rewrite half the
 * template for no reason.
 */

export type Block = {
  /** Name as written in the comment: "paragraph", "yoast/faq-block". */
  name: string;
  attrs: Record<string, unknown>;
  /** Exact attribute source, including its trailing space. Empty when none. */
  attrsRaw: string;
  /** True once `attrs` has been edited and must be re-encoded on output. */
  attrsDirty: boolean;
  innerBlocks: Block[];
  /** Literal HTML chunks; `null` marks the position of the next inner block. */
  innerContent: (string | null)[];
  /** `<!-- wp:name /-->` with no closing tag. */
  selfClosing: boolean;
  /**
   * Whitespace that followed this block at the top level. WordPress writes a
   * blank line between root blocks; keeping it here is what makes an untouched
   * tree serialise back to the exact source string.
   */
  trailing?: string;
};

/**
 * WordPress's block delimiter grammar, ported from `class-wp-block-parser.php`.
 *
 * The attribute group is lazy and guarded by a negative lookahead rather than a
 * plain `[^}]*`, which is what lets it match nested JSON objects — the step
 * columns and the Yoast FAQ block both carry them.
 */
const DELIMITER =
  /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*\/)?([a-z][a-z0-9_-]*)\s+({(?:(?!}\s+\/?-->)[\s\S])*?}\s+)?(\/)?-->/g;

function parseAttrs(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (text === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** A literal HTML run between two delimiters, kept only when it has content. */
function pushHtml(target: Block, html: string): void {
  if (html === "") return;
  target.innerContent.push(html);
}

function emptyBlock(
  name: string,
  attrsRaw: string,
  selfClosing: boolean,
): Block {
  return {
    name,
    attrs: parseAttrs(attrsRaw),
    attrsRaw,
    attrsDirty: false,
    innerBlocks: [],
    innerContent: [],
    selfClosing,
  };
}

/**
 * Parses post content into a block tree.
 *
 * Freeform HTML outside any block — the classic-editor content some older
 * posts still carry — is preserved as literal chunks on the root, so a post
 * that is not fully blocked still round-trips.
 */
export function parseBlocks(content: string): Block[] {
  const root = emptyBlock("__root__", "", false);
  const stack: Block[] = [root];

  let last = 0;
  let match: RegExpExecArray | null;
  DELIMITER.lastIndex = 0;

  while ((match = DELIMITER.exec(content)) !== null) {
    const [whole, closer, namespace, bare, attrsRaw, voidMarker] = match;
    const current = stack[stack.length - 1]!;

    pushHtml(current, content.slice(last, match.index));
    last = match.index + whole.length;

    const name = `${namespace ?? ""}${bare ?? ""}`;

    if (closer === "/") {
      // A stray closer with no matching opener would pop the root; treat it as
      // literal text instead of corrupting the tree.
      if (stack.length > 1 && current.name === name) stack.pop();
      else pushHtml(current, whole);
      continue;
    }

    const block = emptyBlock(name, attrsRaw ?? "", voidMarker === "/");
    current.innerBlocks.push(block);
    current.innerContent.push(null);
    if (!block.selfClosing) stack.push(block);
  }

  pushHtml(stack[stack.length - 1]!, content.slice(last));

  // Unclosed blocks (a truncated paste) keep whatever content they collected
  // rather than being dropped — they are still in the tree and still serialise.
  return rootChildren(root);
}

/**
 * Root-level nodes, keeping any freeform HTML that sat between blocks.
 *
 * Represented as a synthetic block with an empty name so `serializeBlocks` can
 * emit it as bare text with no delimiters around it.
 */
function rootChildren(root: Block): Block[] {
  const out: Block[] = [];
  let i = 0;
  for (const chunk of root.innerContent) {
    if (chunk === null) {
      const child = root.innerBlocks[i];
      i += 1;
      if (child) out.push(child);
      continue;
    }
    if (chunk.trim() === "") {
      // Whitespace between top-level blocks. Attach it to the previous node so
      // the blank lines WordPress writes between blocks are preserved.
      const prev = out[out.length - 1];
      if (prev) prev.trailing = (prev.trailing ?? "") + chunk;
      else out.push(freeform(chunk));
      continue;
    }
    out.push(freeform(chunk));
  }
  return out;
}

function freeform(html: string): Block {
  const block = emptyBlock("", "", false);
  block.innerContent.push(html);
  return block;
}

/**
 * The delimiter's middle section, with the single spaces WordPress writes.
 *
 * Always ends in a space: core emits `<!-- wp:html -->`, not `<!-- wp:html-->`,
 * and the difference is a byte the round-trip test rightly refuses to forgive.
 */
function attrsPart(block: Block): string {
  if (!block.attrsDirty) {
    return block.attrsRaw === "" ? " " : ` ${block.attrsRaw.trim()} `;
  }
  if (Object.keys(block.attrs).length === 0) return " ";
  return ` ${JSON.stringify(block.attrs)} `;
}

export function serializeBlock(block: Block): string {
  let i = 0;
  const inner = block.innerContent
    .map((chunk) => {
      if (chunk !== null) return chunk;
      const child = block.innerBlocks[i];
      i += 1;
      return child ? serializeBlock(child) : "";
    })
    .join("");

  const trailing = block.trailing ?? "";

  // Freeform text carries no delimiters.
  if (block.name === "") return inner + trailing;

  if (block.selfClosing) {
    return `<!-- wp:${block.name}${attrsPart(block)}/-->${trailing}`;
  }

  return `<!-- wp:${block.name}${attrsPart(block)}-->${inner}<!-- /wp:${block.name} -->${trailing}`;
}

export function serializeBlocks(blocks: Block[]): string {
  return blocks.map(serializeBlock).join("");
}

/* ---------------------------------------------------------------------------
 * Tree helpers
 * ------------------------------------------------------------------------ */

/** Depth-first walk, parents before children. */
export function walkBlocks(
  blocks: Block[],
  visit: (block: Block, parent: Block | null) => void,
  parent: Block | null = null,
): void {
  for (const block of blocks) {
    visit(block, parent);
    walkBlocks(block.innerBlocks, visit, block);
  }
}

/** Every block in the tree, flattened, in document order. */
export function flattenBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  walkBlocks(blocks, (b) => out.push(b));
  return out;
}

/** The literal HTML of a block, children serialised in place. */
export function blockHtml(block: Block): string {
  let i = 0;
  return block.innerContent
    .map((chunk) => {
      if (chunk !== null) return chunk;
      const child = block.innerBlocks[i];
      i += 1;
      return child ? blockHtml(child) : "";
    })
    .join("");
}

/** Visible text of a block, tags and entities removed. */
export function blockText(block: Block): string {
  return blockHtml(block)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;/gi, "’")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a paragraph/heading/list block has no author content in it. */
export function isEmptyBlock(block: Block): boolean {
  return blockText(block) === "";
}

/**
 * Replaces a block's own HTML, keeping its name, attributes and delimiters.
 *
 * Used to write generated prose into the template's existing `wp:paragraph`
 * shells so the block type, class names and theme styling stay exactly as the
 * client built them.
 */
export function setBlockHtml(block: Block, html: string): void {
  block.innerBlocks = [];
  block.innerContent = [html];
}

/** Replaces one attribute and marks the block for re-encoding. */
export function setBlockAttr(block: Block, key: string, value: unknown): void {
  block.attrs = { ...block.attrs, [key]: value };
  block.attrsDirty = true;
}

/** Deep copy, so a template block can be cloned without aliasing the original. */
export function cloneBlock(block: Block): Block {
  return {
    name: block.name,
    attrs: { ...block.attrs },
    attrsRaw: block.attrsRaw,
    attrsDirty: block.attrsDirty,
    innerBlocks: block.innerBlocks.map(cloneBlock),
    innerContent: [...block.innerContent],
    selfClosing: block.selfClosing,
    trailing: block.trailing,
  };
}
