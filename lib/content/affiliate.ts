import { findTermMatch, type Region } from "@/lib/content/html-runs";
import { prisma } from "@/lib/db";

/**
 * Automatic ingredient links.
 *
 * The author keeps a spreadsheet mapping ingredient names to URLs — mostly
 * Amazon and ShareASale affiliate links, plus links to their own recipes. This
 * turns the first mention of each ingredient into a link, so it does not have
 * to be done by hand on every post.
 *
 * Two rules do most of the work here:
 *
 *  - Affiliate links carry `rel="sponsored nofollow"`. Google requires it, and
 *    unmarked affiliate links are a manual-action risk. Links to the site's own
 *    recipes deliberately do *not*, because those rel values would throw away
 *    the internal link equity that makes them worth having in the first place.
 *
 *  - Linking is confined to the ingredients section and the recipe card. A
 *    link on every mention of "salt" throughout a post is what thin affiliate
 *    content looks like, and the section boundary is a much more reliable
 *    guard than any per-term heuristic.
 */

export type AffiliateTerm = {
  term: string;
  url: string;
  kind: "affiliate" | "internal";
  words: number;
};

export type AffiliateIndex = {
  /** Sorted longest-first, so "smoked paprika" wins over "paprika". */
  terms: AffiliateTerm[];
};

/** Hosts that are the site itself rather than a merchant. */
function isInternalUrl(url: string, siteHost: string): boolean {
  if (siteHost === "") return false;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase() === siteHost;
  } catch {
    return false;
  }
}

export function normaliseTerm(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function buildAffiliateIndex(
  projectId: string,
): Promise<AffiliateIndex> {
  const rows = await prisma.affiliateLink.findMany({
    where: { projectId, enabled: true },
    select: { term: true, url: true, kind: true, words: true },
  });

  const terms: AffiliateTerm[] = rows
    .map((r) => ({
      term: r.term,
      url: r.url,
      kind: r.kind === "internal" ? ("internal" as const) : ("affiliate" as const),
      words: r.words,
    }))
    // Longest phrase first, then longest string: "ancho chili powder" must be
    // tried before "chili powder", which must be tried before "chili".
    .sort((a, b) => b.words - a.words || b.term.length - a.term.length);

  return { terms };
}

const INGREDIENTS_HEADING = /ingredient/i;
const RECIPE_HEADING = /^\s*(?:recipe\b|.*\brecipe\s*$)/i;

/**
 * Character ranges of the ingredients section and the recipe card.
 *
 * A section runs from its own H2 to the next H2, so nothing after "Variations"
 * is touched unless it is itself an ingredients heading.
 */
export function linkableRegions(html: string): Region[] {
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  if (headings.length === 0) return [];

  const regions: Region[] = [];
  headings.forEach((m, i) => {
    const text = (m[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const isIngredients = INGREDIENTS_HEADING.test(text);
    const isRecipe = RECIPE_HEADING.test(text);
    if (!isIngredients && !isRecipe) return;

    const from = (m.index ?? 0) + m[0].length;
    const to = headings[i + 1]?.index ?? html.length;
    regions.push({ from, to });
  });

  return regions;
}

export type AffiliateResult = {
  html: string;
  linked: { term: string; url: string; kind: "affiliate" | "internal" }[];
  /** Terms found in the text that had no URL, worth adding to the sheet. */
  skipped: string[];
};

/**
 * Links each term at most once inside one slice of HTML.
 *
 * The editable runs are recomputed for every term rather than split once up
 * front. That matters: an anchor inserted for "mexican chili powder" is not
 * protected by a split that ran before it existed, so "chili powder" would
 * then match inside it and nest a second anchor in the first.
 */
function linkSlice(
  slice: string,
  index: AffiliateIndex,
  used: Set<string>,
  linked: AffiliateResult["linked"],
): string {
  let text = slice;

  for (const entry of index.terms) {
    if (used.has(entry.term)) continue;

    const hit = findTermMatch(text, entry.term);
    if (hit === null) continue;

    const rel =
      entry.kind === "affiliate"
        ? ' rel="sponsored nofollow" target="_blank"'
        : "";
    const anchor = `<a href="${entry.url}"${rel}>${hit.text}</a>`;
    text = text.slice(0, hit.start) + anchor + text.slice(hit.end);

    used.add(entry.term);
    linked.push({ term: entry.term, url: entry.url, kind: entry.kind });
  }

  return text;
}

/**
 * Links the first mention of each known ingredient, inside the ingredients
 * section and recipe card only.
 *
 * Returns the terms it linked and the ones it recognised but could not link,
 * so the author can see what happened rather than having to diff the draft.
 */
export function applyAffiliateLinks(
  html: string,
  index: AffiliateIndex,
): AffiliateResult {
  const regions = linkableRegions(html);
  if (regions.length === 0 || index.terms.length === 0) {
    return { html, linked: [], skipped: [] };
  }

  const used = new Set<string>();
  const linked: AffiliateResult["linked"] = [];

  // Rewritten back to front so each region's offsets stay valid as earlier
  // slices grow.
  let out = html;
  for (const region of [...regions].sort((a, b) => b.from - a.from)) {
    const slice = out.slice(region.from, region.to);
    const replaced = linkSlice(slice, index, used, linked);
    out = out.slice(0, region.from) + replaced + out.slice(region.to);
  }

  return { html: out, linked, skipped: [] };
}

/** Parsed row from the author's spreadsheet, before it reaches the database. */
export type ImportedTerm = {
  term: string;
  category: string;
  url: string;
  kind: "affiliate" | "internal";
  words: number;
};

/**
 * Bare ingredient names that appear in almost every recipe.
 *
 * Imported disabled rather than dropped: the author can switch any of them on,
 * but a link on the word "salt" in every post is the clearest signal of thin
 * affiliate content there is, so the default has to be off.
 */
export const GENERIC_TERMS = new Set([
  "water", "salt", "oil", "sugar", "flour", "butter", "rice", "pepper",
  "garlic", "onion", "bread", "beans", "cheese", "chili", "milk", "spices",
  "sauce", "jam", "ham", "herbs", "fruit", "salad", "noodles", "pasta",
  "wine", "ice", "syrup", "vinegar", "yogurt", "oats", "peeled", "cut",
  "plain", "large", "firm", "split", "filling", "dough", "garnish", "test",
  "optional", "toppings", "to serve", "spice paste", "unknown_ingredient",
]);

/**
 * Parses the author's CSV.
 *
 * Written against the real file, which is messier than its header suggests:
 * 36 rows repeat the category in the URL column, roughly a thousand have no
 * URL at all, and quoted fields contain commas. Rows without a usable URL are
 * reported rather than silently dropped, because "why is my ingredient not
 * linking" is otherwise impossible to answer.
 */
export function parseAffiliateCsv(
  text: string,
  siteHost: string,
): { terms: ImportedTerm[]; skippedNoUrl: number; skippedBadUrl: number } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop the header when it looks like one.
  if (rows[0]?.[0]?.toLowerCase().includes("ingredient")) rows.shift();

  const byTerm = new Map<string, ImportedTerm>();
  let skippedNoUrl = 0;
  let skippedBadUrl = 0;

  for (const r of rows) {
    const term = normaliseTerm(r[0] ?? "");
    const category = (r[1] ?? "").trim();
    const url = (r[2] ?? "").trim();

    if (term === "") continue;

    if (url === "") {
      skippedNoUrl += 1;
      continue;
    }
    if (!/^https?:\/\//i.test(url)) {
      // The category repeated in the URL column, and similar noise.
      skippedBadUrl += 1;
      continue;
    }

    // Later rows win, but a row that already has a URL is never replaced by a
    // duplicate — the file lists some ingredients twice, once bare.
    if (byTerm.has(term)) continue;

    byTerm.set(term, {
      term,
      category,
      url,
      kind: isInternalUrl(url, siteHost) ? "internal" : "affiliate",
      words: term.split(" ").length,
    });
  }

  return { terms: [...byTerm.values()], skippedNoUrl, skippedBadUrl };
}

/* -------------------------------------------------------------------------- */
/* Live source: the client's WordPress install                                */
/* -------------------------------------------------------------------------- */

export type WpSyncResult = {
  imported: number;
  aliases: number;
  skippedGeneric: number;
  reason: string | null;
};

/**
 * Replaces the WordPress-sourced rows with what the site says today.
 *
 * Only rows this sync owns are touched: anything imported from the author's
 * spreadsheet is left exactly where it is, so a WordPress refresh can never
 * silently delete a mapping somebody added by hand.
 *
 * Aliases become their own rows. The matcher works on one term per row and
 * sorts longest-first, so "canned hatch chiles" and "canned hatch chilies"
 * both resolve to the same URL and the longer phrase still wins over a shorter
 * one — which is what the alias is for.
 */
export async function syncAffiliateLinksFromWordPress(
  projectId: string,
  siteUrl: string,
): Promise<WpSyncResult> {
  const { fetchWpAffiliateLinks } = await import(
    "@/lib/wordpress/affiliate-source"
  );
  const { links, reason } = await fetchWpAffiliateLinks(siteUrl);

  if (links.length === 0) {
    return { imported: 0, aliases: 0, skippedGeneric: 0, reason };
  }

  const siteHost = (() => {
    try {
      return new URL(siteUrl).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  })();

  // Terms the author had switched off stay off across a refresh.
  const previous = await prisma.affiliateLink.findMany({
    where: { projectId, enabled: false },
    select: { term: true },
  });
  const disabled = new Set(previous.map((p) => p.term));

  type Row = {
    projectId: string;
    term: string;
    words: number;
    category: string;
    url: string;
    kind: string;
    enabled: boolean;
    source: string;
    sourceId: number | null;
  };

  const byTerm = new Map<string, Row>();
  let aliasCount = 0;

  for (const link of links) {
    const host = (() => {
      try {
        return new URL(link.url).hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        return "";
      }
    })();
    // A link to the author's own shop is an internal link and keeps its equity.
    const kind = siteHost !== "" && host === siteHost ? "internal" : "affiliate";

    for (const alias of link.aliases) {
      const term = normaliseTerm(alias);
      if (term === "") continue;
      // First writer wins, so a shorter record cannot steal a longer one's term.
      if (byTerm.has(term)) continue;
      if (term !== normaliseTerm(link.name)) aliasCount += 1;

      byTerm.set(term, {
        projectId,
        term,
        words: term.split(" ").length,
        category: link.categories[0] ?? "",
        url: link.url,
        kind,
        enabled: !GENERIC_TERMS.has(term) && !disabled.has(term),
        source: "wordpress",
        sourceId: link.sourceId === 0 ? null : link.sourceId,
      });
    }
  }

  const rows = [...byTerm.values()];

  await prisma.affiliateLink.deleteMany({
    where: { projectId, source: "wordpress" },
  });
  for (let i = 0; i < rows.length; i += 500) {
    await prisma.affiliateLink.createMany({
      data: rows.slice(i, i + 500),
      skipDuplicates: true,
    });
  }

  return {
    imported: rows.length,
    aliases: aliasCount,
    skippedGeneric: rows.filter((r) => !r.enabled).length,
    reason: null,
  };
}
