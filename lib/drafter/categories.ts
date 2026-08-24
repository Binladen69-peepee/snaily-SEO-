/**
 * Choosing which of the site's real categories a post belongs in.
 *
 * The export was sending `categories: []` and `tags: []`, so every draft landed
 * in Uncategorized and the author re-filed it by hand. The connector has
 * matched categories by name since 1.3.0 — nothing was ever sent to match.
 *
 * The rule that matters is the one this codebase already applies to links: a
 * name is either a real term on the site or it is dropped. A model is good at
 * saying "this is Tex-Mex comfort food" and has no way to know that the site's
 * term is called "Mexican Recipes"; so the model proposes from a list of real
 * names and every proposal is checked back against that list before it goes
 * anywhere near WordPress.
 */

export type SiteTerm = {
  name: string;
  /** Published posts in the term. Used to prefer a real section over a stub. */
  count: number;
};

export type CategoryChoice = {
  /** The primary category, first. Empty when nothing matched. */
  categories: string[];
  tags: string[];
  /** Names the model proposed that the site does not have. */
  rejected: string[];
};

function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Matches a proposed name to a real term.
 *
 * Exact first, then the same name with or without a trailing "recipes" — the
 * site has both "Middle Eastern Recipes" and "Desserts", and a model asked for
 * a cuisine will write "Middle Eastern" for one and "Desserts" for the other.
 * Nothing looser than that: "Mains" and "Middle Eastern Recipes" share a word
 * and are not the same shelf.
 */
export function matchTerm(proposed: string, terms: SiteTerm[]): SiteTerm | null {
  const wanted = key(proposed);
  if (wanted === "") return null;

  const exact = terms.find((t) => key(t.name) === wanted);
  if (exact !== undefined) return exact;

  const bare = wanted.replace(/\s*recipes?$/, "").trim();
  const loose = terms.find((t) => key(t.name).replace(/\s*recipes?$/, "").trim() === bare);
  return loose ?? null;
}

/**
 * Turns the model's reply into real category and tag names.
 *
 * `PRIMARY` is kept first because that is what the connector reads as the
 * primary category, and Yoast stores exactly one.
 */
export function resolveCategories(
  raw: string,
  categories: SiteTerm[],
  tags: SiteTerm[],
  max = 4,
): CategoryChoice {
  const field = (name: string): string[] => {
    const m = new RegExp(`^${name}:\\s*(.*)$`, "im").exec(raw);
    return (m?.[1] ?? "")
      .split(/[,;|]/)
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s !== "" && !/^(none|n\/a|-)$/i.test(s));
  };

  const rejected: string[] = [];
  const chosen: string[] = [];
  const seen = new Set<string>();

  const take = (names: string[], into: string[], pool: SiteTerm[]) => {
    for (const name of names) {
      const term = matchTerm(name, pool);
      if (term === null) {
        rejected.push(name);
        continue;
      }
      if (seen.has(term.name)) continue;
      seen.add(term.name);
      into.push(term.name);
    }
  };

  take(field("PRIMARY").slice(0, 1), chosen, categories);
  take(field("OTHER"), chosen, categories);

  const chosenTags: string[] = [];
  take(field("TAGS"), chosenTags, tags);

  return {
    categories: chosen.slice(0, max),
    tags: chosenTags.slice(0, max),
    rejected,
  };
}

/** The list a model is allowed to choose from, biggest sections first. */
export function formatTermList(terms: SiteTerm[], limit = 60): string {
  return terms
    .slice(0, limit)
    .map((t) => `- ${t.name}`)
    .join("\n");
}
