import type { Prisma } from "@prisma/client";

/**
 * Shape the GEO Lab UI actually renders. Prisma's Json `faq` column and
 * extra Date fields are not safe to pass through as-is.
 */

export type GeoFaq = { question: string; answer: string };

export type GeoIdeaView = {
  id: string;
  title: string;
  moment: string;
  category: string;
  rationale: string;
  attributes: string[];
  anchorText: string;
  linkUrl: string;
  status: string;
  draftHtml: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  faq: GeoFaq[];
  qaNotes: string | null;
  redundantWith: string | null;
  seed: string;
};

export function parseFaq(value: unknown): GeoFaq[] {
  if (!Array.isArray(value)) return [];
  const out: GeoFaq[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as { question?: unknown; answer?: unknown };
    if (typeof row.question !== "string" || typeof row.answer !== "string") {
      continue;
    }
    out.push({ question: row.question, answer: row.answer });
    if (out.length >= 10) break;
  }
  return out;
}

export function faqToJson(faq: GeoFaq[]): Prisma.InputJsonValue {
  return faq;
}

export function serializeIdea(row: {
  id: string;
  title: string;
  moment: string;
  category: string;
  rationale: string;
  attributes: unknown;
  anchorText: string;
  linkUrl: string;
  status: string;
  draftHtml: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  faq: unknown;
  qaNotes: string | null;
  redundantWith: string | null;
  seed: string;
}): GeoIdeaView {
  return {
    id: row.id,
    title: row.title,
    moment: row.moment,
    category: row.category,
    rationale: row.rationale,
    attributes: Array.isArray(row.attributes)
      ? row.attributes.filter((a): a is string => typeof a === "string")
      : [],
    anchorText: row.anchorText ?? "",
    linkUrl: row.linkUrl ?? "",
    status: row.status,
    draftHtml: row.draftHtml ?? "",
    metaTitle: row.metaTitle ?? "",
    metaDescription: row.metaDescription ?? "",
    slug: row.slug ?? "",
    faq: parseFaq(row.faq),
    qaNotes: row.qaNotes,
    redundantWith: row.redundantWith,
    seed: row.seed,
  };
}
