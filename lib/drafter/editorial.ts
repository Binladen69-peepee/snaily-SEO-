export type EditorialMeta = {
  excerpt: string;
  slug: string;
  seoTitle: string;
  seoDescription: string;
  featuredImageUrl: string;
  featuredAssetId: string;
  categories: string[];
  tags: string[];
  dismissedTerms: string[];
  protectedVocab: string[];
};

export const EMPTY_EDITORIAL: EditorialMeta = {
  excerpt: "",
  slug: "",
  seoTitle: "",
  seoDescription: "",
  featuredImageUrl: "",
  featuredAssetId: "",
  categories: [],
  tags: [],
  dismissedTerms: [],
  protectedVocab: [],
};

export type ArticleRevision = {
  id: string;
  at: string;
  kind: "outline" | "redraft" | "proof" | "restore";
  title: string;
  content: string;
};

export function parseEditorial(value: unknown): EditorialMeta {
  if (value === null || typeof value !== "object") return { ...EMPTY_EDITORIAL };
  const v = value as Partial<EditorialMeta>;
  return {
    excerpt: typeof v.excerpt === "string" ? v.excerpt : "",
    slug: typeof v.slug === "string" ? v.slug : "",
    seoTitle: typeof v.seoTitle === "string" ? v.seoTitle : "",
    seoDescription: typeof v.seoDescription === "string" ? v.seoDescription : "",
    featuredImageUrl: typeof v.featuredImageUrl === "string" ? v.featuredImageUrl : "",
    featuredAssetId: typeof v.featuredAssetId === "string" ? v.featuredAssetId : "",
    categories: Array.isArray(v.categories)
      ? v.categories.filter((x): x is string => typeof x === "string")
      : [],
    tags: Array.isArray(v.tags)
      ? v.tags.filter((x): x is string => typeof x === "string")
      : [],
    dismissedTerms: Array.isArray(v.dismissedTerms)
      ? v.dismissedTerms.filter((x): x is string => typeof x === "string")
      : [],
    protectedVocab: Array.isArray(v.protectedVocab)
      ? v.protectedVocab.filter((x): x is string => typeof x === "string")
      : [],
  };
}

export function parseRevisions(value: unknown): ArticleRevision[] {
  if (!Array.isArray(value)) return [];
  const out: ArticleRevision[] = [];
  for (const row of value) {
    if (row === null || typeof row !== "object") continue;
    const r = row as Partial<ArticleRevision>;
    if (typeof r.id !== "string" || typeof r.content !== "string") continue;
    const kind = r.kind;
    if (
      kind !== "outline" &&
      kind !== "redraft" &&
      kind !== "proof" &&
      kind !== "restore"
    ) {
      continue;
    }
    out.push({
      id: r.id,
      at: typeof r.at === "string" ? r.at : new Date().toISOString(),
      kind,
      title: typeof r.title === "string" ? r.title : "",
      content: r.content,
    });
  }
  return out.slice(-20);
}

export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 200));
}

export function pushRevision(
  existing: unknown,
  next: Omit<ArticleRevision, "id" | "at">,
): ArticleRevision[] {
  const prev = parseRevisions(existing);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r-${String(Date.now())}`;
  return [
    ...prev,
    {
      id,
      at: new Date().toISOString(),
      kind: next.kind,
      title: next.title,
      content: next.content,
    },
  ].slice(-20);
}
