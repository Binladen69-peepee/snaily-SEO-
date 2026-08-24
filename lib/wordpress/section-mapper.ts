import {
  blockHtml,
  blockText,
  cloneBlock,
  flattenBlocks,
  isEmptyBlock,
  parseBlocks,
  serializeBlocks,
  setBlockAttr,
  setBlockHtml,
  walkBlocks,
  type Block,
} from "@/lib/wordpress/blocks";
import { stepLabel } from "@/lib/drafter/steps";
import {
  classifyHeading,
  headingLevel,
  SECTION_LABELS,
  type SectionKey,
  type TemplateSection,
  type TemplateStructure,
} from "@/lib/wordpress/template";

/**
 * Maps a finished Drafter article into the client's WordPress template.
 *
 * The template is the source of truth for structure. This never builds a
 * section, never invents a wrapper and never reorders anything — it finds the
 * template's own shells and writes the generated prose into them. Everything
 * it does not recognise comes out of the other side untouched, which is what
 * keeps the theme CSS, the Feast blocks and the WP Recipe Maker card working.
 *
 * Two rules are load-bearing:
 *
 *  - Step numbers are drawn by CSS from the `numpic turn2` class on each step
 *    image, not from the heading. So step headings are safe to replace with the
 *    generated ones, and the image classes are never touched — including when
 *    extra step columns have to be cloned, where the four-class cycle continues
 *    so the rotation stays right.
 *
 *  - Images are never uploaded. The author's WordPress workflow handles photos
 *    and alt text separately, so the template's empty image blocks are left
 *    exactly as they are and any app-hosted image in the draft is dropped
 *    rather than shipped as a URL that would 404 on the live site.
 */

/* ---------------------------------------------------------------------------
 * Reading the generated article
 * ------------------------------------------------------------------------ */

/** One top-level element of the editor's HTML. */
type Element = { tag: string; html: string; text: string };

const TOP_LEVEL =
  /<(p|h[1-6]|ul|ol|blockquote|figure|table|div)\b[^>]*>[\s\S]*?<\/\1>|<img\b[^>]*\/?>|<hr\b[^>]*\/?>/gi;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitElements(html: string): Element[] {
  const out: Element[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOP_LEVEL.lastIndex = 0;

  while ((m = TOP_LEVEL.exec(html)) !== null) {
    const gap = html.slice(last, m.index).trim();
    if (gap !== "" && stripTags(gap) !== "") {
      out.push({ tag: "p", html: `<p>${gap}</p>`, text: stripTags(gap) });
    }
    const tag = (/<([a-z0-9]+)/i.exec(m[0])?.[1] ?? "p").toLowerCase();
    out.push({ tag, html: m[0], text: stripTags(m[0]) });
    last = m.index + m[0].length;
  }

  const tail = html.slice(last).trim();
  if (tail !== "" && stripTags(tail) !== "") {
    out.push({ tag: "p", html: `<p>${tail}</p>`, text: stripTags(tail) });
  }

  return out;
}

/**
 * Splits a list into one paragraph per item.
 *
 * "Why you'll adore this recipe" is a run of emoji-led lines, and writing them
 * as a Markdown list is the obvious thing for a model to do — the editor hides
 * the markers, so the draft looks right and the export maps the `<ul>` onto a
 * WordPress list block. The client's published posts do not have bullets there.
 *
 * Done at the export boundary as well as at composition, so a draft written
 * before that rule existed still lands correctly rather than needing a rewrite.
 */
function listToParagraphs(el: Element): Element[] {
  if (el.tag !== "ul" && el.tag !== "ol") return [el];

  const items = [...el.html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
  if (items.length === 0) return [el];

  return items.map((m) => {
    // A list item that already wraps its text in a paragraph would otherwise
    // become <p><p>…</p></p>.
    const inner = (m[1] ?? "").trim().replace(/^<p\b[^>]*>([\s\S]*)<\/p>$/i, "$1");
    return { tag: "p", html: `<p>${inner}</p>`, text: stripTags(inner) };
  });
}

/** Inner HTML of an element, so it can go inside the template's own tag. */
function innerHtml(html: string): string {
  const m = /^<[a-z0-9]+\b[^>]*>([\s\S]*)<\/[a-z0-9]+>$/i.exec(html.trim());
  return (m?.[1] ?? html).trim();
}

export type ArticleStep = { heading: string; body: Element[] };
export type ArticleFaq = { question: string; answer: string };

export type ArticleSection = {
  key: SectionKey;
  /** Inner HTML of the generated H2, so its links and emphasis survive. */
  headingHtml: string;
  headingText: string;
  body: Element[];
};

export type ArticleContent = {
  sections: Map<SectionKey, ArticleSection>;
  steps: ArticleStep[];
  faqs: ArticleFaq[];
  /** Headings in the draft that match no template section. */
  unmatched: { heading: string; words: number }[];
  /** App-hosted images found in the draft, which are deliberately not sent. */
  localImages: number;
};

/** Images served by this app would 404 on the live site once linked from it. */
const LOCAL_IMAGE = /<(?:img|figure)\b[^>]*(?:\/api\/articles\/[^"']+\/media\/|data:image)/i;

/**
 * Splits the editor's HTML into the sections the template can receive.
 *
 * Sections are identified by heading wording, not position, so an author
 * reordering or renaming a heading still lands in the right place — and a
 * heading that matches nothing is reported rather than dropped silently.
 */
export function readArticle(html: string): ArticleContent {
  const elements = splitElements(html);

  const sections = new Map<SectionKey, ArticleSection>();
  const unmatched: { heading: string; words: number }[] = [];
  const steps: ArticleStep[] = [];
  const faqs: ArticleFaq[] = [];
  let localImages = 0;

  const intro: ArticleSection = {
    key: "intro",
    headingHtml: "",
    headingText: "",
    body: [],
  };
  sections.set("intro", intro);

  let current: ArticleSection | null = intro;
  let currentKey: SectionKey | null = "intro";
  let pendingUnmatched: { heading: string; words: number } | null = null;

  // Sub-heading state for the two sections that have inner structure.
  let step: ArticleStep | null = null;
  let faq: ArticleFaq | null = null;

  const closeStep = () => {
    if (step !== null && (step.heading !== "" || step.body.length > 0)) {
      steps.push(step);
    }
    step = null;
  };
  const closeFaq = () => {
    if (faq !== null && faq.question !== "") faqs.push(faq);
    faq = null;
  };

  for (const el of elements) {
    if (LOCAL_IMAGE.test(el.html)) {
      localImages += 1;
      continue;
    }

    const heading = /^<h([1-6])\b[^>]*>([\s\S]*)<\/h\1>$/i.exec(el.html.trim());

    if (heading) {
      const level = Number(heading[1]);
      const inner = (heading[2] ?? "").trim();
      const text = stripTags(inner);

      if (level <= 2) {
        closeStep();
        closeFaq();
        const key = classifyHeading(text);
        if (key === null) {
          pendingUnmatched = { heading: text, words: 0 };
          unmatched.push(pendingUnmatched);
          current = null;
          currentKey = null;
          continue;
        }
        pendingUnmatched = null;
        currentKey = key;
        const existing = sections.get(key);
        if (existing) {
          current = existing;
        } else {
          current = { key, headingHtml: inner, headingText: text, body: [] };
          sections.set(key, current);
        }
        continue;
      }

      // H3 inside a section with inner structure.
      if (currentKey === "how-to-make") {
        closeStep();
        step = { heading: text, body: [] };
        continue;
      }
      if (currentKey === "faqs") {
        closeFaq();
        faq = { question: inner, answer: "" };
        continue;
      }
      // Any other H3 is ordinary section content.
      if (current !== null) current.body.push(el);
      continue;
    }

    if (pendingUnmatched !== null) {
      pendingUnmatched.words += el.text.split(/\s+/).filter(Boolean).length;
      continue;
    }

    if (step !== null) {
      step.body.push(el);
      continue;
    }

    if (faq !== null) {
      const piece = innerHtml(el.html);
      faq.answer = faq.answer === "" ? piece : `${faq.answer}<br><br>${piece}`;
      continue;
    }

    if (current !== null) current.body.push(el);
  }

  closeStep();
  closeFaq();

  return { sections, steps, faqs, unmatched, localImages };
}

/* ---------------------------------------------------------------------------
 * Writing into the template
 * ------------------------------------------------------------------------ */

/** Parent lookup, so a block can be replaced or removed in place. */
type ParentMap = Map<Block, Block>;

/**
 * A stand-in parent for the top level of the document.
 *
 * Without one, a section whose only shell sits at the root — "Serving Ideas"
 * and the intro, in the real template — had no parent to insert a clone into,
 * so a second paragraph of the author's prose was quietly dropped. Wrapping
 * the roots in a synthetic block gives every shell somewhere to grow.
 *
 * `innerBlocks` is the caller's own array, not a copy, so splices through this
 * wrapper are visible to whoever serialises the original list.
 */
const ROOT = "__root__";

function rootWrapper(blocks: Block[]): Block {
  return {
    name: ROOT,
    attrs: {},
    attrsRaw: "",
    attrsDirty: false,
    innerBlocks: blocks,
    innerContent: blocks.map(() => null),
    selfClosing: false,
  };
}

function parentMap(root: Block): ParentMap {
  const map: ParentMap = new Map();
  for (const block of root.innerBlocks) map.set(block, root);
  walkBlocks(root.innerBlocks, (block, parent) => {
    if (parent !== null) map.set(block, parent);
  });
  return map;
}

/** Index of `child` inside `parent.innerBlocks`, or -1. */
function indexIn(parent: Block, child: Block): number {
  return parent.innerBlocks.indexOf(child);
}

/**
 * Inserts `added` immediately after `after`, keeping `innerContent` aligned.
 *
 * `innerContent` interleaves literal HTML with `null` placeholders, one per
 * child, so an insert has to update both arrays or serialisation drifts.
 *
 * Nested blocks get the blank line WordPress writes between siblings. At the
 * top level that spacing lives on each block's own `trailing`, which the clone
 * already carries, so no separator is added there.
 */
function insertAfter(parent: Block, after: Block, added: Block[]): void {
  if (added.length === 0) return;
  const at = indexIn(parent, after);
  if (at === -1) return;

  parent.innerBlocks.splice(at + 1, 0, ...added);

  const filler: (string | null)[] =
    parent.name === ROOT
      ? added.map(() => null)
      : added.flatMap(() => ["\n\n", null]);

  let seen = -1;
  for (let i = 0; i < parent.innerContent.length; i += 1) {
    if (parent.innerContent[i] !== null) continue;
    seen += 1;
    if (seen === at) {
      parent.innerContent.splice(i + 1, 0, ...filler);
      return;
    }
  }
}

/** Inserts `added` immediately before `before`, keeping `innerContent` aligned. */
function insertBefore(parent: Block, before: Block, added: Block[]): void {
  if (added.length === 0) return;
  const at = indexIn(parent, before);
  if (at === -1) return;

  parent.innerBlocks.splice(at, 0, ...added);

  const root = parent.name === ROOT;
  // At the top level the blank line between blocks lives on each block, not in
  // the parent's content list.
  if (root) {
    for (const block of added) block.trailing ??= "\n\n";
  }

  const filler: (string | null)[] = root
    ? added.map(() => null)
    : added.flatMap(() => [null, "\n\n"]);

  let seen = -1;
  for (let i = 0; i < parent.innerContent.length; i += 1) {
    if (parent.innerContent[i] !== null) continue;
    seen += 1;
    if (seen === at) {
      parent.innerContent.splice(i, 0, ...filler);
      return;
    }
  }
}

/**
 * Removes a child, taking the blank line that separated it with it.
 *
 * Deleting only the block leaves its surrounding whitespace behind, and four
 * removed step columns then show up as a run of empty lines in the editor's
 * code view. The literal chunk that followed the block goes too when it is
 * nothing but whitespace.
 */
function removeBlock(parent: Block, child: Block): void {
  const at = indexIn(parent, child);
  if (at === -1) return;

  parent.innerBlocks.splice(at, 1);

  let seen = -1;
  for (let i = 0; i < parent.innerContent.length; i += 1) {
    if (parent.innerContent[i] !== null) continue;
    seen += 1;
    if (seen !== at) continue;

    const next = parent.innerContent[i + 1];
    const drop = typeof next === "string" && next.trim() === "" ? 2 : 1;
    parent.innerContent.splice(i, drop);
    return;
  }
}

/**
 * Rewrites a heading's text while keeping its tag, classes and anchor id.
 *
 * The anchor is what the Feast jump-to block and the theme's own links point
 * at, so it survives even though the words change. A heading wrapped entirely
 * in `<strong>` — as the template's "How to make" is — keeps that wrapper.
 */
function replaceHeadingText(block: Block, html: string): void {
  const source = blockHtml(block);
  const m = /^([\s\S]*?<h[1-6]\b[^>]*>)([\s\S]*?)(<\/h[1-6]>[\s\S]*)$/i.exec(source);
  if (!m) {
    setBlockHtml(block, html);
    return;
  }

  const inner = (m[2] ?? "").trim();
  const wrapped = /^<(strong|em|b|i)\b[^>]*>[\s\S]*<\/\1>$/i.exec(inner);
  const body = wrapped ? `<${wrapped[1]}>${html}</${wrapped[1]}>` : html;

  setBlockHtml(block, `${m[1] ?? ""}${body}${m[3] ?? ""}`);
}

/** Rewrites a paragraph's text, keeping the `<p>` tag's own attributes. */
function replaceParagraph(block: Block, html: string): void {
  const source = blockHtml(block);
  const m = /^([\s\S]*?<p\b[^>]*>)([\s\S]*?)(<\/p>[\s\S]*)$/i.exec(source);
  if (!m) {
    setBlockHtml(block, `<p>${html}</p>`);
    return;
  }
  setBlockHtml(block, `${m[1] ?? ""}${html}${m[3] ?? ""}`);
}

function replaceListItem(block: Block, html: string): void {
  const source = blockHtml(block);
  const m = /^([\s\S]*?<li\b[^>]*>)([\s\S]*?)(<\/li>[\s\S]*)$/i.exec(source);
  if (!m) {
    setBlockHtml(block, `<li>${html}</li>`);
    return;
  }
  setBlockHtml(block, `${m[1] ?? ""}${html}${m[3] ?? ""}`);
}

/**
 * The blocks in a section that can take prose.
 *
 * Images are excluded on purpose: the client's photo workflow owns those, and
 * an export that filled them would be inventing image URLs.
 */
function fillableParagraphs(body: Block[]): Block[] {
  return body.filter((b) => b.name === "paragraph" && isEmptyBlock(b));
}

export type SectionReport = {
  key: SectionKey;
  label: string;
  /** In the template, in the article, and how many blocks were written. */
  inTemplate: boolean;
  inArticle: boolean;
  blocksWritten: number;
  note?: string;
};

export type MappingReport = {
  sections: SectionReport[];
  stepsMapped: number;
  stepSlotsInTemplate: number;
  stepColumnsAdded: number;
  stepColumnsRemoved: number;
  faqsMapped: number;
  relatedIds: number[];
  /**
   * True when the template carries a WP Recipe Maker block. The plugin emits
   * its own Recipe structured data, so the export must not add a second copy.
   */
  recipeCardPreserved: boolean;
  /** Draft headings that matched no template section, with their word counts. */
  unmapped: { heading: string; words: number }[];
  /** Template headings the classifier did not recognise. */
  unknownTemplateHeadings: string[];
  localImagesSkipped: number;
  /** True when a human should look before this draft ships. */
  needsReview: boolean;
};

/**
 * The step image's rotation class, by position.
 *
 * The template cycles `turn2`, `turn3`, `turn`, none across its eight steps.
 * Cloned columns continue the cycle rather than repeating the last one, so a
 * recipe with more steps than the template still looks like the template.
 */
const TURN_CYCLE = ["turn2", "turn3", "turn", ""];

function setStepImageClass(column: Block, index: number): void {
  const image = column.innerBlocks.find((b) => b.name === "image");
  if (!image) return;

  const turn = TURN_CYCLE[index % TURN_CYCLE.length] ?? "";
  const className = `numpic${turn === "" ? "" : ` ${turn}`}`;

  setBlockAttr(image, "className", className);
  setBlockHtml(
    image,
    blockHtml(image).replace(
      /class="wp-block-image[^"]*"/i,
      `class="wp-block-image ${className}"`,
    ),
  );
}

type StepSlot = { columns: Block; column: Block; heading: Block | null; body: Block[] };

function columnSlot(columns: Block, column: Block): StepSlot {
  return {
    columns,
    column,
    heading:
      column.innerBlocks.find(
        (b) => b.name === "heading" && headingLevel(b) >= 3,
      ) ?? null,
    body: column.innerBlocks.filter((b) => b.name === "paragraph"),
  };
}

/**
 * The template's step columns, in reading order.
 *
 * Scoped to columns whose own content the section index already assigned to
 * "How to make", so a `wp:columns` used decoratively elsewhere in the template
 * is never mistaken for a step.
 */
function stepSlots(section: TemplateSection, blocks: Block[]): StepSlot[] {
  const owned = new Set<Block>([
    ...section.body,
    ...section.subheadings.map((h) => h.block),
  ]);
  const slots: StepSlot[] = [];

  walkBlocks(blocks, (block) => {
    if (block.name !== "columns") return;
    for (const column of block.innerBlocks) {
      if (column.name !== "column") continue;
      if (!column.innerBlocks.some((b) => owned.has(b))) continue;
      slots.push(columnSlot(block, column));
    }
  });

  return slots;
}

export type PopulateOptions = {
  /** Article title, used where the template heading names the dish. */
  title: string;
  /** Verified WordPress post IDs for the related-recipes grid. */
  relatedIds?: number[];
};

/**
 * Writes the article into the template tree and returns the new post content.
 *
 * The tree is mutated in place; callers pass a freshly parsed structure, and
 * the original WordPress post is never written to.
 */
export function populateTemplate(
  structure: TemplateStructure,
  article: ArticleContent,
  options: PopulateOptions,
): { content: string; report: MappingReport } {
  const root = rootWrapper(structure.blocks);
  const parents = parentMap(root);
  const reports: SectionReport[] = [];

  let stepColumnsAdded = 0;
  let stepColumnsRemoved = 0;
  let stepsMapped = 0;
  let faqsMapped = 0;

  /**
   * Turns a paragraph shell into a list block in place.
   *
   * A `<ul>` cannot live inside a `<p>`, so the shell changes type rather than
   * moving — which keeps the content at the position the template put it.
   * The `wp-block-list` class and the newlines are what core writes, so the
   * result is indistinguishable from a list added in the editor.
   */
  function becomeList(shell: Block, el: Element): void {
    const ordered = el.tag === "ol";
    shell.name = "list";
    shell.attrs = ordered ? { ordered: true } : {};
    shell.attrsDirty = true;
    shell.innerBlocks = [];

    const items = [...el.html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(
      (m) => `<!-- wp:list-item -->\n<li>${(m[1] ?? "").trim()}</li>\n<!-- /wp:list-item -->`,
    );
    const tag = ordered ? "ol" : "ul";

    setBlockHtml(
      shell,
      `\n<${tag} class="wp-block-list">${items.join("\n\n")}</${tag}>\n`,
    );
    // Re-parsed so the list items are real child blocks rather than raw text.
    const reparsed = parseBlocks(
      `<!-- wp:list${ordered ? ' {"ordered":true}' : ""} -->${blockHtml(shell)}<!-- /wp:list -->`,
    )[0];
    if (reparsed) {
      shell.innerBlocks = reparsed.innerBlocks;
      shell.innerContent = reparsed.innerContent;
      walkBlocks(shell.innerBlocks, (b, p) => {
        parents.set(b, p ?? shell);
      });
    }
  }

  /** Writes a list of elements into a section's paragraph shells. */
  function fillProse(shells: Block[], body: Element[]): number {
    if (body.length === 0) return 0;

    let written = 0;
    let shellIndex = 0;
    let anchor: Block | null = null;

    for (const el of body) {
      const shell = shells[shellIndex];
      shellIndex += 1;

      if (shell) {
        if (el.tag === "ul" || el.tag === "ol") becomeList(shell, el);
        else replaceParagraph(shell, innerHtml(el.html));
        anchor = shell;
        written += 1;
        continue;
      }

      // Ran out of template shells. Clone the last one so the extra prose
      // keeps its place in the template's own structure.
      const source = anchor ?? shells[shells.length - 1] ?? null;
      if (source === null) break;
      const parent = parents.get(source);
      if (!parent) break;

      const clone = cloneBlock(source);
      clone.name = "paragraph";
      clone.attrs = {};
      clone.attrsRaw = "";
      clone.attrsDirty = false;
      clone.innerBlocks = [];
      clone.innerContent = ["\n<p></p>\n"];

      if (el.tag === "ul" || el.tag === "ol") becomeList(clone, el);
      else setBlockHtml(clone, `\n<p>${innerHtml(el.html)}</p>\n`);

      insertAfter(parent, source, [clone]);
      parents.set(clone, parent);
      anchor = clone;
      written += 1;
    }

    return written;
  }

  /* ---- Ordinary prose sections -------------------------------------- */

  const PROSE: SectionKey[] = [
    "intro",
    "why",
    "ingredients",
    "variations",
    "serving",
  ];

  for (const key of PROSE) {
    const slot = structure.sections.get(key);
    const source = article.sections.get(key);

    if (!slot) {
      reports.push({
        key,
        label: SECTION_LABELS[key],
        inTemplate: false,
        inArticle: source !== undefined,
        blocksWritten: 0,
        note:
          source === undefined
            ? undefined
            : "The template has no matching section, so this content was not placed.",
      });
      continue;
    }

    if (!source) {
      reports.push({
        key,
        label: SECTION_LABELS[key],
        inTemplate: true,
        inArticle: false,
        blocksWritten: 0,
        note: "The draft has no content for this section; the template's own is left as it was.",
      });
      continue;
    }

    if (slot.heading !== null && source.headingHtml !== "") {
      replaceHeadingText(slot.heading, source.headingHtml);
    }

    /*
     * The one section that must never arrive as a list. Everything else keeps
     * whatever shape the author wrote.
     */
    const body =
      key === "why" ? source.body.flatMap(listToParagraphs) : source.body;

    const written = fillProse(fillableParagraphs(slot.body), body);

    reports.push({
      key,
      label: SECTION_LABELS[key],
      inTemplate: true,
      inArticle: true,
      blocksWritten: written,
      note:
        written < body.length
          ? `Section mapping requires review: ${String(body.length - written)} block(s) of the draft could not be placed.`
          : undefined,
    });
  }

  /* ---- How to make: heading, lead paragraph, step columns ------------ */

  const stepSection = structure.sections.get("how-to-make");
  const stepSource = article.sections.get("how-to-make");
  const slots = stepSection ? stepSlots(stepSection, structure.blocks) : [];
  const stepSlotsInTemplate = slots.length;

  if (stepSection) {
    if (stepSection.heading !== null && stepSource?.headingHtml) {
      replaceHeadingText(stepSection.heading, stepSource.headingHtml);
    }

    // The lead paragraph sits above the grid; the columns' own paragraphs are
    // excluded so a step's prose never lands in the section intro.
    const columnParagraphs = new Set(slots.flatMap((s) => s.body));
    const lead = fillableParagraphs(stepSection.body).filter(
      (b) => !columnParagraphs.has(b),
    );
    if (stepSource) fillProse(lead, stepSource.body);

    const steps = article.steps;

    for (let i = 0; i < steps.length; i += 1) {
      const stepData = steps[i]!;
      let slot = slots[i];

      if (!slot) {
        // More steps than the template lays out. Clone the last pair of
        // columns and continue the CSS rotation on the new images.
        const last = slots[slots.length - 1];
        if (!last) break;
        const parent = parents.get(last.columns);
        if (!parent) break;

        const clonedColumns = cloneBlock(last.columns);
        insertAfter(parent, last.columns, [clonedColumns]);
        parents.set(clonedColumns, parent);
        walkBlocks([clonedColumns], (b, p) => {
          if (p !== null) parents.set(b, p);
        });

        for (const column of clonedColumns.innerBlocks) {
          if (column.name !== "column") continue;
          const heading =
            column.innerBlocks.find(
              (b) => b.name === "heading" && headingLevel(b) >= 3,
            ) ?? null;
          slots.push({
            columns: clonedColumns,
            column,
            heading,
            body: column.innerBlocks.filter((b) => b.name === "paragraph"),
          });
          stepColumnsAdded += 1;
        }

        slot = slots[i];
        if (!slot) break;
      }

      /*
       * The heading is written from the step's position, not from the draft.
       * It is the template's numbering, and a cloned column would otherwise
       * repeat whatever the last one said.
       */
      if (slot.heading !== null) {
        replaceHeadingText(slot.heading, stepLabel(i));
      }
      setStepImageClass(slot.column, i);
      fillProse(slot.body.filter(isEmptyBlock), stepData.body);
      stepsMapped += 1;
    }

    // Steps the recipe does not have. A labelled, empty "Step Seven" on a
    // published post is a defect, so the unused columns come out - and a pair
    // that ends up empty takes its `wp:columns` wrapper with it.
    const touched = new Set<Block>();
    for (let i = steps.length; i < slots.length; i += 1) {
      const slot = slots[i]!;
      removeBlock(slot.columns, slot.column);
      touched.add(slot.columns);
      stepColumnsRemoved += 1;
    }
    for (const columns of touched) {
      if (columns.innerBlocks.some((b) => b.name === "column")) continue;
      const parent = parents.get(columns);
      if (parent) removeBlock(parent, columns);
    }
  }

  reports.push({
    key: "how-to-make",
    label: SECTION_LABELS["how-to-make"],
    inTemplate: stepSection !== undefined,
    inArticle: article.steps.length > 0,
    blocksWritten: stepsMapped,
    note:
      stepColumnsAdded > 0
        ? `${String(stepColumnsAdded)} extra step column(s) cloned from the template.`
        : stepColumnsRemoved > 0
          ? `${String(stepColumnsRemoved)} unused step column(s) removed.`
          : undefined,
  });

  /* ---- Top tips: the template's ordered list ------------------------- */

  const tipsSection = structure.sections.get("tips");
  const tipsSource = article.sections.get("tips");
  let tipsWritten = 0;

  if (tipsSection && tipsSource) {
    if (tipsSection.heading !== null && tipsSource.headingHtml !== "") {
      replaceHeadingText(tipsSection.heading, tipsSource.headingHtml);
    }

    const list = tipsSection.body.find((b) => b.name === "list");
    const tips = tipsSource.body.flatMap((el) =>
      el.tag === "ul" || el.tag === "ol"
        ? [...el.html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) =>
            (m[1] ?? "").trim(),
          )
        : [innerHtml(el.html)],
    );

    if (list && tips.length > 0) {
      const template = list.innerBlocks.find((b) => b.name === "list-item");
      if (template) {
        const items = tips.map((tip) => {
          const item = cloneBlock(template);
          replaceListItem(item, tip);
          return item;
        });
        // Rebuilt rather than patched: the list's own `<ol class="wp-block-list">`
        // wrapper is kept and one `list-item` child is emitted per tip.
        const source = blockHtml(list);
        const open = /^([\s\S]*?<[ou]l\b[^>]*>)/i.exec(source)?.[1] ?? "<ol>";
        const close = /(<\/[ou]l>[\s\S]*)$/i.exec(source)?.[1] ?? "</ol>";
        list.innerBlocks = items;
        list.innerContent = [open, ...items.map(() => null), close];
        tipsWritten = items.length;
      } else {
        fillProse(fillableParagraphs(tipsSection.body), tipsSource.body);
        tipsWritten = tipsSource.body.length;
      }
    } else {
      tipsWritten = fillProse(fillableParagraphs(tipsSection.body), tipsSource.body);
    }
  }

  reports.push({
    key: "tips",
    label: SECTION_LABELS.tips,
    inTemplate: tipsSection !== undefined,
    inArticle: tipsSource !== undefined,
    blocksWritten: tipsWritten,
  });

  let faqBlockCreated = false;

  /* ---- Recipe FAQs: the Yoast block --------------------------------- */

  const faqSection = structure.sections.get("faqs");
  const faqSource = article.sections.get("faqs");

  if (faqSection) {
    if (faqSection.heading !== null && faqSource?.headingHtml) {
      replaceHeadingText(faqSection.heading, faqSource.headingHtml);
    }
    const faqBlock = faqSection.body.find((b) => b.name === "yoast/faq-block");

    if (faqBlock && article.faqs.length > 0) {
      writeYoastFaq(faqBlock, article.faqs);
      faqsMapped = article.faqs.length;
    } else if (article.faqs.length > 0) {
      /*
       * The template has an FAQ section but no Yoast block in it, so the
       * questions used to be poured into ordinary paragraphs. They read fine
       * and carried no FAQ schema and did not collapse, which is most of the
       * reason the section exists. One is built instead.
       */
      const built = buildYoastFaqBlock(article.faqs);
      const anchor =
        faqSection.body[faqSection.body.length - 1] ?? faqSection.heading;
      const parent = anchor === null ? undefined : parents.get(anchor);

      if (built !== null && anchor !== null && parent !== undefined) {
        insertAfter(parent, anchor, [built]);
        parents.set(built, parent);
        // The template's own placeholder paragraphs would sit above an FAQ
        // that now says the same thing.
        for (const block of fillableParagraphs(faqSection.body)) {
          if (isEmptyBlock(block)) removeBlock(parent, block);
        }
        faqsMapped = article.faqs.length;
        faqBlockCreated = true;
      } else if (faqSource) {
        faqsMapped = fillProse(fillableParagraphs(faqSection.body), faqSource.body);
      }
    } else if (faqSource) {
      faqsMapped = fillProse(fillableParagraphs(faqSection.body), faqSource.body);
    }
  }

  reports.push({
    key: "faqs",
    label: SECTION_LABELS.faqs,
    inTemplate: faqSection !== undefined,
    inArticle: article.faqs.length > 0,
    blocksWritten: faqsMapped,
    note: faqBlockCreated
      ? "The template had no Yoast FAQ block, so one was built - the questions ship with FAQ schema and collapse as they do on the site."
      : undefined,
  });

  /* ---- You'll love these too: the Feast related-recipes grid --------- */

  const relatedSection = structure.sections.get("related");
  const relatedSource = article.sections.get("related");
  const relatedIds = (options.relatedIds ?? []).filter((n) => n > 0);

  let relatedFallback = false;

  if (relatedSection) {
    if (relatedSection.heading !== null && relatedSource?.headingHtml) {
      replaceHeadingText(relatedSection.heading, relatedSource.headingHtml);
    }

    const grid = relatedSection.body.find((b) => b.name === "feast/fsri-block");

    if (grid && relatedIds.length > 0) {
      // The Feast block takes a comma-separated list of real post IDs, and it
      // is the template's own way of rendering this section as image cards.
      // Every ID came from a synced published post, so the grid can only ever
      // link pages that exist.
      setBlockAttr(grid, "id", `${relatedIds.join(", ")}, `);
    } else if (relatedSource !== undefined && relatedSource.body.length > 0) {
      /*
       * Nothing the author listed resolved to a post ID. The grid has no way
       * to render it, and the section is otherwise nothing but the grid - so
       * their list goes in above it as ordinary content rather than being
       * dropped on the floor.
       */
      const anchor = grid ?? relatedSection.body[relatedSection.body.length - 1];
      const parent = anchor === undefined ? undefined : parents.get(anchor);

      if (anchor !== undefined && parent !== undefined) {
        const added: Block[] = [];
        for (const el of relatedSource.body) {
          const block = parseBlocks("<!-- wp:paragraph -->\n<p></p>\n<!-- /wp:paragraph -->")[0];
          if (!block) continue;
          parents.set(block, parent);
          if (el.tag === "ul" || el.tag === "ol") becomeList(block, el);
          else setBlockHtml(block, `\n<p>${innerHtml(el.html)}</p>\n`);
          added.push(block);
        }
        if (added.length > 0) {
          insertBefore(parent, anchor, added);
          for (const block of added) parents.set(block, parent);
          relatedFallback = true;
        }
      }
    }
  }

  reports.push({
    key: "related",
    label: SECTION_LABELS.related,
    inTemplate: relatedSection !== undefined,
    inArticle: relatedSource !== undefined,
    blocksWritten: relatedIds.length > 0 ? relatedIds.length : relatedFallback ? 1 : 0,
    note:
      relatedIds.length > 0
        ? undefined
        : relatedFallback
          ? "No recipe name matched a published post, so the list was kept as text above the grid rather than dropped."
          : relatedSection !== undefined
            ? "The related grid was left exactly as the template had it."
            : undefined,
  });

  /* ---- Recipe card: never touched ------------------------------------ */

  const wprm = flattenBlocks(structure.blocks).some(
    (b) => b.name === "wp-recipe-maker/recipe",
  );

  reports.push({
    key: "recipe",
    label: SECTION_LABELS.recipe,
    inTemplate: wprm || structure.sections.has("recipe"),
    inArticle: article.sections.has("recipe"),
    blocksWritten: 0,
    note: wprm
      ? "WP Recipe Maker block preserved. The recipe card is created in WordPress, as it is today."
      : undefined,
  });

  const unmapped = article.unmatched.filter((u) => u.words > 0);

  const report: MappingReport = {
    sections: reports,
    stepsMapped,
    stepSlotsInTemplate,
    stepColumnsAdded,
    stepColumnsRemoved,
    faqsMapped,
    relatedIds,
    recipeCardPreserved: wprm,
    unmapped,
    unknownTemplateHeadings: structure.unknownHeadings,
    localImagesSkipped: article.localImages,
    needsReview:
      unmapped.length > 0 ||
      reports.some((r) => r.inArticle && !r.inTemplate) ||
      reports.some((r) => r.note?.startsWith("Section mapping requires review")) ||
      (article.steps.length > 0 && stepsMapped < article.steps.length),
  };

  return { content: serializeBlocks(structure.blocks), report };
}

/**
 * Rewrites the Yoast FAQ block from the draft's questions.
 *
 * Yoast keeps the questions twice — as block attributes for the schema it
 * emits, and as rendered HTML in the block body. Both are written here, in the
 * exact shape the published posts use, so the block opens as a normal editable
 * FAQ in WordPress and ships valid FAQ structured data.
 */
function writeYoastFaq(block: Block, faqs: ArticleFaq[]): void {
  const base = Date.now();

  /*
   * `answer` is rendered and may carry an anchor; `jsonAnswer` is what Yoast
   * puts into the FAQPage schema, where markup is not content. They were the
   * same string, which was harmless only for as long as the FAQ was excluded
   * from internal linking.
   */
  const questions = faqs.map((faq, i) => {
    const id = `faq-question-${String(base + i)}`;
    return {
      id,
      question: faq.question,
      answer: faq.answer,
      jsonQuestion: stripTags(faq.question),
      jsonAnswer: stripTags(faq.answer),
      images: [] as unknown[],
    };
  });

  setBlockAttr(block, "questions", questions);

  const sections = questions
    .map(
      (q) =>
        `<div class="schema-faq-section" id="${q.id}"><strong class="schema-faq-question">${q.question}</strong> <p class="schema-faq-answer">${q.answer}</p> </div> `,
    )
    .join("");

  setBlockHtml(
    block,
    `\n<div class="schema-faq wp-block-yoast-faq-block">${sections}</div>\n`,
  );
}

/**
 * A Yoast FAQ block from scratch, for a template that has none.
 *
 * Built by serialising the comment and re-parsing it, rather than by
 * assembling a Block by hand: the parser is the thing that decides what a
 * valid block looks like here, and going through it means a block this code
 * creates cannot differ from one the template shipped with.
 */
function buildYoastFaqBlock(faqs: ArticleFaq[]): Block | null {
  const block = parseBlocks(
    "<!-- wp:yoast/faq-block -->\n<div class=\"schema-faq wp-block-yoast-faq-block\"></div>\n<!-- /wp:yoast/faq-block -->",
  )[0];
  if (!block) return null;

  writeYoastFaq(block, faqs);
  return block;
}

/** Text of every heading in a tree — used by the preview to show the mapping. */
export function templateHeadings(blocks: Block[]): string[] {
  return flattenBlocks(blocks)
    .filter((b) => b.name === "heading")
    .map(blockText)
    .filter((t) => t !== "");
}
