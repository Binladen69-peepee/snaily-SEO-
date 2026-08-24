import { prisma } from "@/lib/db";
import { classifyHeading, type SectionKey } from "@/lib/wordpress/sections";
import {
  blockText,
  flattenBlocks,
  parseBlocks,
  type Block,
} from "@/lib/wordpress/blocks";

/**
 * Finding and reading the client's real WordPress post template.
 *
 * The export duplicates an existing post — "Blog Post Template" on
 * cinnamonsnail.com — rather than building markup from scratch. That post is
 * the source of truth for section order, group wrappers, the two-column step
 * grid, the `numpic turn2` image classes the theme numbers with CSS, and the
 * Feast / Yoast / WP Recipe Maker blocks. This module locates it and describes
 * its sections; nothing here writes to WordPress.
 *
 * The template is read from the synced `WpPost` mirror rather than fetched per
 * export. The connector already pulls drafts, so the template arrives with
 * every sync, and one post's markup does not need a live round trip each time
 * an author presses Send.
 */

export {
  SECTION_LABELS,
  classifyHeading,
  normaliseHeading,
  type SectionKey,
} from "@/lib/wordpress/sections";

/* ---------------------------------------------------------------------------
 * Reading a template's structure
 * ------------------------------------------------------------------------ */

/** A heading block plus the level parsed out of its markup. */
export type HeadingRef = {
  block: Block;
  level: number;
  text: string;
};

export function headingLevel(block: Block): number {
  if (block.name !== "heading") return 0;
  const attr = block.attrs.level;
  if (typeof attr === "number" && attr >= 1 && attr <= 6) return attr;
  // Core omits `level` for H2, the default.
  const tag = /<h([1-6])\b/i.exec(
    block.innerContent.filter((c): c is string => c !== null).join(""),
  );
  return tag ? Number(tag[1]) : 2;
}

export type TemplateSection = {
  key: SectionKey;
  /** The H2 that opens the section. Null for the intro, which has none. */
  heading: Block | null;
  /** Blocks belonging to this section, in document order, headings excluded. */
  body: Block[];
  /** H3s inside the section — the step and FAQ headings. */
  subheadings: HeadingRef[];
};

export type TemplateStructure = {
  blocks: Block[];
  sections: Map<SectionKey, TemplateSection>;
  /** Section headings found in the template, in the order they appear. */
  order: SectionKey[];
  /** Headings the classifier did not recognise, reported rather than ignored. */
  unknownHeadings: string[];
};

/**
 * Groups a parsed post into sections.
 *
 * Walks the flattened tree so a heading inside a `wp:group` still opens a
 * section — which is how the real template is built: "Why you'll adore" and
 * "Top tips" both live inside `feast-top-tip` groups, and the step grid sits
 * inside a group of its own.
 *
 * Group and column wrappers are not added to `body`; only their leaf content
 * is, because a wrapper is structure the export must never fill or delete.
 */
export function readStructure(content: string): TemplateStructure {
  const blocks = parseBlocks(content);
  const flat = flattenBlocks(blocks);

  const sections = new Map<SectionKey, TemplateSection>();
  const order: SectionKey[] = [];
  const unknownHeadings: string[] = [];

  const intro: TemplateSection = {
    key: "intro",
    heading: null,
    body: [],
    subheadings: [],
  };
  sections.set("intro", intro);
  order.push("intro");

  let current = intro;

  for (const block of flat) {
    if (block.name === "heading") {
      const level = headingLevel(block);
      const text = blockText(block);

      if (level <= 2) {
        const key = classifyHeading(text);
        if (key === null) {
          if (text !== "") unknownHeadings.push(text);
          // An unrecognised H2 still ends the previous section — its content
          // belongs to it, not to whatever came before.
          current = {
            key: current.key,
            heading: block,
            body: [],
            subheadings: [],
          };
          continue;
        }
        const section: TemplateSection = {
          key,
          heading: block,
          body: [],
          subheadings: [],
        };
        // A repeated section keeps the first occurrence; duplicates are rare
        // and the first is the one the author sees at the top of the post.
        if (!sections.has(key)) {
          sections.set(key, section);
          order.push(key);
          current = section;
        } else {
          current = sections.get(key)!;
        }
        continue;
      }

      current.subheadings.push({ block, level, text });
      continue;
    }

    // Structural wrappers are navigated through, never filled.
    if (block.name === "group" || block.name === "columns" || block.name === "column") {
      continue;
    }
    if (block.name === "") continue;

    current.body.push(block);
  }

  return { blocks, sections, order, unknownHeadings };
}

/* ---------------------------------------------------------------------------
 * Locating the template post
 * ------------------------------------------------------------------------ */

export type TemplateCandidate = {
  wpId: number;
  title: string;
  type: string;
  status: string;
  /** How many of the ten known sections its headings match. */
  matchedSections: number;
  sections: SectionKey[];
};

/**
 * Titles that read as a reusable post template rather than an article.
 *
 * Deliberately narrow: the site also has "Class Page Template" and "Free Class
 * Template" pages, which are landing pages and must not be offered as the blog
 * post template.
 */
const TEMPLATE_TITLE = /\b(blog\s*post|post|recipe)\b[\s-]*template\b/i;

/**
 * Every post on the site that could serve as the blog post template.
 *
 * Scored by how many recognised sections its headings cover, so the picker can
 * put the real one first and the author can confirm rather than hunt for an ID.
 */
export async function findTemplateCandidates(
  projectId: string,
): Promise<TemplateCandidate[]> {
  const rows = await prisma.wpPost.findMany({
    where: { projectId, type: "post" },
    select: { wpId: true, title: true, type: true, status: true, content: true },
    orderBy: { modifiedAt: "desc" },
    take: 400,
  });

  const scored = rows
    .filter((r) => TEMPLATE_TITLE.test(r.title) && r.content.trim() !== "")
    .map((r) => {
      const structure = readStructure(r.content);
      const keys = structure.order.filter((k) => k !== "intro");
      return {
        wpId: r.wpId,
        title: r.title,
        type: r.type,
        status: r.status,
        matchedSections: keys.length,
        sections: keys,
      };
    });

  return scored.sort(
    (a, b) => b.matchedSections - a.matchedSections || a.wpId - b.wpId,
  );
}

export type ResolvedTemplate = {
  wpId: number;
  title: string;
  status: string;
  structure: TemplateStructure;
  /** True when the ID came from project settings rather than auto-detection. */
  configured: boolean;
};

export class TemplateNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateNotFound";
  }
}

/**
 * The template this project exports through.
 *
 * Uses the ID saved in project settings when there is one. Otherwise it falls
 * back to the best-scoring candidate, so a project works before anyone visits
 * settings — but the chosen ID is reported either way, because "which template
 * did it use" must never be a guess the author cannot see.
 */
export async function resolveTemplate(
  projectId: string,
): Promise<ResolvedTemplate> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { wpTemplatePostId: true },
  });

  const configuredId = project?.wpTemplatePostId ?? null;

  if (configuredId !== null) {
    const row = await prisma.wpPost.findUnique({
      where: { projectId_wpId: { projectId, wpId: configuredId } },
      select: { wpId: true, title: true, status: true, content: true },
    });

    if (!row || row.content.trim() === "") {
      throw new TemplateNotFound(
        "Configured Cinnamon Snail Blog Post Template could not be found. Re-sync WordPress, or pick the template again in project settings.",
      );
    }

    return {
      wpId: row.wpId,
      title: row.title,
      status: row.status,
      structure: readStructure(row.content),
      configured: true,
    };
  }

  const candidates = await findTemplateCandidates(projectId);
  const best = candidates[0];

  if (!best || best.matchedSections < 4) {
    throw new TemplateNotFound(
      "Configured Cinnamon Snail Blog Post Template could not be found. Choose it in project settings, then try again.",
    );
  }

  const row = await prisma.wpPost.findUnique({
    where: { projectId_wpId: { projectId, wpId: best.wpId } },
    select: { wpId: true, title: true, status: true, content: true },
  });

  if (!row) {
    throw new TemplateNotFound(
      "Configured Cinnamon Snail Blog Post Template could not be found.",
    );
  }

  return {
    wpId: row.wpId,
    title: row.title,
    status: row.status,
    structure: readStructure(row.content),
    configured: false,
  };
}
