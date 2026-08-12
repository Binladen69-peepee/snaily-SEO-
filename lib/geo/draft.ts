import { complete } from "@/lib/ai";
import {
  CATEGORY_LABEL,
  MOMENT_LABEL,
  TRUST_CATEGORIES,
  type AnchorPage,
} from "@/lib/geo/config";
import type { BusinessFactsInput } from "@/lib/geo/generate";
import type { RawSignal } from "@/lib/geo/signals";

/**
 * The drafting pipeline.
 *
 * Deliberately staged rather than one prompt. Single-prompt generation is
 * where AI drifts into generic fluff and invents specifics; splitting outline
 * from prose from FAQ from metadata keeps each step narrow enough to check.
 *
 * Business Facts are the only facts a draft may state. Anything not recorded
 * there has to be written qualitatively or left out — enforced in the prompts
 * and then checked again afterwards, because a prompt rule is a request, not a
 * guarantee.
 */

export type FaqItem = { question: string; answer: string };

export type DraftResult = {
  html: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  faq: FaqItem[];
  /** Anything the self-QA pass flagged. Shown to the human before publishing. */
  qaNotes: string | null;
};

export type DraftInput = {
  title: string;
  moment: string;
  category: string;
  rationale: string;
  attributes: string[];
  seed: string;
  anchor: AnchorPage;
  facts: BusinessFactsInput;
  /** Real questions from PAA / Search Console — the FAQ may only use these. */
  signals: RawSignal[];
  /** Natural anchor text proposed when the idea was mapped. */
  anchorTextHint: string;
  /** Existing posts worth linking to. */
  related: { title: string; url: string }[];
};

/* -------------------------------------------------------------------------
 * Grounding
 * ---------------------------------------------------------------------- */

function factsBlock(f: BusinessFactsInput): string {
  const lines: string[] = [];
  const add = (label: string, value: string) => {
    if (value.trim() !== "") lines.push(`${label}: ${value.trim()}`);
  };

  add("Service area", f.serviceArea);
  add("Travel policy", f.travelPolicy);
  add("Event types", f.eventTypes);
  if (f.guestMin !== null || f.guestMax !== null) {
    lines.push(
      `Guest counts: ${f.guestMin === null ? "no stated minimum" : `minimum ${String(f.guestMin)}`}; ${
        f.guestMax === null ? "no stated maximum" : `maximum ${String(f.guestMax)}`
      }`,
    );
  }
  add("Dietary handling", f.dietaryHandling);
  add("Pricing logic", f.pricingLogic);
  add("Booking / lead time", f.leadTime);
  add("Consulting scope", f.consultingScope);
  if (f.pastEvents.length > 0) {
    lines.push(
      `Past events that may be referenced in general terms:\n- ${f.pastEvents.join("\n- ")}`,
    );
  }

  return lines.length > 0 ? lines.join("\n") : "(nothing recorded)";
}

/** Rules every stage inherits. */
function groundingRules(f: BusinessFactsInput): string {
  return [
    "GROUNDING RULES — these override anything else:",
    "- The Business Facts below are the ONLY facts you may state.",
    "- Never invent a price, a price range, a service area, a town, a policy, a lead time, a guest limit, a statistic, an award, a client, or an availability promise.",
    "- If a specific is not in the facts, write about it qualitatively or leave it out. Qualitative is always better than invented.",
    "- Never make a health claim of any kind.",
    "- Do not claim the business has done something that is not in the recorded past events.",
    f.neverClaim.length > 0
      ? `- The owner has explicitly forbidden these claims: ${f.neverClaim.join("; ")}`
      : "",
    "",
    "BUSINESS FACTS:",
    factsBlock(f),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function categoryBrief(id: string): string {
  return TRUST_CATEGORIES.find((c) => c.id === id)?.brief ?? "";
}

/* -------------------------------------------------------------------------
 * Stage 1 — outline
 * ---------------------------------------------------------------------- */

async function outline(input: DraftInput): Promise<string> {
  const system = [
    "You outline a short, genuinely useful article for a local business.",
    "",
    "Answer-first: the opening must answer the question in the title directly, in two or three sentences, before any context.",
    "Sections use the phrasing a real person would type, not keyword phrases.",
    "5–8 sections maximum. This is a helpful article, not an exhaustive guide.",
    "",
    groundingRules(input.facts),
  ].join("\n");

  const user = [
    `Article title: ${input.title}`,
    `Search moment: ${MOMENT_LABEL[input.moment] ?? input.moment}`,
    `Trust category: ${CATEGORY_LABEL[input.category] ?? input.category}`,
    `What this category means: ${categoryBrief(input.category)}`,
    `Why this should get cited: ${input.rationale}`,
    input.attributes.length > 0
      ? `Concrete attributes to build around: ${input.attributes.join(", ")}`
      : "",
    "",
    "Return a plain outline: the direct answer, then the section headings, one per line. No commentary.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return complete(system, user, 800);
}

/* -------------------------------------------------------------------------
 * Stage 2 — prose
 * ---------------------------------------------------------------------- */

async function prose(input: DraftInput, plan: string): Promise<string> {
  const system = [
    "You write short, plain, genuinely useful articles for a vegan catering and culinary consulting business.",
    "",
    "VOICE:",
    "- Short paragraphs, two to four sentences. No walls of text.",
    "- Warm and direct. Confident without hype.",
    "- No filler openers ('In today's world', 'When it comes to').",
    "- Clarity beats personality here — these are helpful articles, not recipe posts, so skip the pun headings.",
    "- Never keyword-stuff. Write the sentence a person would actually say.",
    "",
    "FORMAT:",
    "- Return clean semantic HTML only: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a>.",
    "- Do NOT output <html>, <head>, <body>, <h1>, class attributes, inline styles, or markdown fences.",
    "- The H1 is the article title and is added separately — never write one.",
    "- Open with the direct answer in a <p>, before the first <h2>.",
    "",
    groundingRules(input.facts),
  ].join("\n");

  const linkBlock = [
    input.anchor.url !== ""
      ? `- Link once to the ${input.anchor.label} page at ${input.anchor.url}, using natural anchor text such as "${input.anchorTextHint}". Never use an exact-match keyword as the anchor.`
      : `- The ${input.anchor.label} page has no URL recorded, so do not fabricate one. Mention the service naturally without linking.`,
    ...input.related
      .slice(0, 3)
      .map((r) => `- Optionally link to "${r.title}" at ${r.url} if it genuinely fits.`),
  ].join("\n");

  const user = [
    `Article title: ${input.title}`,
    `Search moment: ${MOMENT_LABEL[input.moment] ?? input.moment}`,
    `Trust category: ${CATEGORY_LABEL[input.category] ?? input.category}`,
    "",
    "Outline to follow:",
    plan,
    "",
    "Internal links:",
    linkBlock,
    "",
    "Write the article body as HTML. 600–1000 words. Return only the HTML.",
  ].join("\n");

  return complete(system, user, 3000);
}

/* -------------------------------------------------------------------------
 * Stage 3 — FAQ from real questions only
 * ---------------------------------------------------------------------- */

async function faq(input: DraftInput, body: string): Promise<FaqItem[]> {
  const questions = input.signals
    .filter((s) => s.source === "paa" || s.phrase.trim().endsWith("?"))
    .map((s) => s.phrase)
    .slice(0, 20);

  // The spec is explicit that the FAQ comes from observed questions, not
  // invented ones. With no observed questions there is no FAQ.
  if (questions.length === 0) return [];

  const system = [
    "You select and answer real questions for an article's FAQ block.",
    "",
    "- Choose 3–5 questions from the supplied list. Never write a question that is not on it.",
    "- Keep the asker's phrasing; only tidy capitalisation and punctuation.",
    "- Answer each in one to three sentences. Direct, no preamble.",
    "- Skip any question the article body already answers in full.",
    "",
    groundingRules(input.facts),
  ].join("\n");

  const user = [
    `Article title: ${input.title}`,
    "",
    "Questions actually observed for this topic:",
    questions.map((q) => `- ${q}`).join("\n"),
    "",
    "Article body for context:",
    body.replace(/<[^>]+>/g, " ").slice(0, 2500),
    "",
    'Return a JSON array: [{ "question": string, "answer": string }]. Only the array.',
  ].join("\n");

  const raw = await complete(system, user, 1200);
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1) return [];

  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];

    const allowed = new Set(questions.map((q) => q.toLowerCase().replace(/\W+/g, "")));

    return (parsed as FaqItem[])
      .filter(
        (f) =>
          typeof f.question === "string" &&
          typeof f.answer === "string" &&
          f.question.trim() !== "" &&
          // Enforced here too: a question the model invented is dropped.
          allowed.has(f.question.toLowerCase().replace(/\W+/g, "")),
      )
      .slice(0, 5);
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------
 * Stage 4 — metadata
 * ---------------------------------------------------------------------- */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/, "");
}

async function metadata(
  input: DraftInput,
  body: string,
): Promise<{ metaTitle: string; metaDescription: string; slug: string }> {
  const system = [
    "You write search metadata. Plain and accurate, never clickbait.",
    "- Title tag: 50–60 characters.",
    "- Meta description: 140–160 characters, describing what the reader will learn.",
    "- Neither may state a fact absent from the article.",
    "",
    groundingRules(input.facts),
  ].join("\n");

  const user = [
    `Article title: ${input.title}`,
    "Article body:",
    body.replace(/<[^>]+>/g, " ").slice(0, 2000),
    "",
    'Return JSON: { "metaTitle": string, "metaDescription": string }. Only the object.',
  ].join("\n");

  let metaTitle = input.title.slice(0, 60);
  let metaDescription = "";

  try {
    const raw = await complete(system, user, 400);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        metaTitle?: string;
        metaDescription?: string;
      };
      if (parsed.metaTitle) metaTitle = parsed.metaTitle.trim();
      if (parsed.metaDescription) metaDescription = parsed.metaDescription.trim();
    }
  } catch {
    // Metadata is a nicety; a failure here must not lose the draft.
  }

  return { metaTitle, metaDescription, slug: slugify(input.title) };
}

/* -------------------------------------------------------------------------
 * Stage 5 — sanitise and self-QA
 * ---------------------------------------------------------------------- */

/** Tags WordPress should receive. Everything else is stripped. */
const ALLOWED = new Set([
  "h2","h3","h4","p","ul","ol","li","strong","em","a","blockquote","br",
]);

/**
 * Produces WordPress-ready HTML.
 *
 * Strips markdown fences, document scaffolding, class and style attributes,
 * and any tag outside the allow-list — the paste target is the WP block editor,
 * which chokes on app markup and inline styling.
 */
export function cleanHtml(raw: string): string {
  let html = raw
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/<\/?(?:html|head|body|main|article|section|div|span|figure)[^>]*>/gi, "")
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .trim();

  // Drop every attribute except href on anchors.
  html = html.replace(/<([a-z0-9]+)((?:\s+[^>]*)?)>/gi, (match, tag: string, attrs: string) => {
    const name = tag.toLowerCase();
    if (!ALLOWED.has(name)) return "";

    if (name === "a") {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
      // Only real links survive; a placeholder href would ship a broken link.
      if (!/^https?:\/\//i.test(href)) return "";
      return `<a href="${href}">`;
    }
    return `<${name}>`;
  });

  html = html.replace(/<\/([a-z0-9]+)>/gi, (match, tag: string) =>
    ALLOWED.has(tag.toLowerCase()) ? `</${tag.toLowerCase()}>` : "",
  );

  return html
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Renders the FAQ as a plain WordPress-friendly block. */
export function faqHtml(items: FaqItem[]): string {
  if (items.length === 0) return "";
  return [
    "<h2>Frequently asked questions</h2>",
    ...items.map(
      (f) =>
        `<h3>${escapeHtml(f.question)}</h3>\n<p>${escapeHtml(f.answer)}</p>`,
    ),
  ].join("\n");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Words that carry the shape of a rule rather than its subject.
 *
 * "No health claims" is about health, not about the word "claims" — matching
 * on the scaffolding is why a naive check never fires on real prose.
 */
const RULE_SCAFFOLDING = new Set([
  "never", "avoid", "dont", "about", "claim", "claims", "claiming", "mention",
  "mentioning", "promise", "promises", "promising", "state", "stating", "make",
  "making", "imply", "implying", "language", "anything",
]);

/**
 * Whether the draft looks like it touches one of the owner's forbidden claims.
 *
 * Substring rather than whole-word matching, so "health" catches "healthy",
 * and a majority of the rule's subject words must appear — enough that a
 * single incidental word does not cry wolf, loose enough that the check
 * actually fires. These are review notes, never a block, so the bias is
 * deliberately towards flagging.
 */
function touches(text: string, claim: string): boolean {
  const subject = claim
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !RULE_SCAFFOLDING.has(w));

  if (subject.length === 0) return false;

  // Crude stemming both ways: "health" has to catch "healthy", and
  // "availability" has to catch "available".
  const hits = subject.filter(
    (w) => text.includes(w) || (w.length >= 7 && text.includes(w.slice(0, 6))),
  ).length;

  return hits / subject.length >= 0.6;
}

/**
 * Mechanical checks over the finished draft.
 *
 * Deliberately not another model call — these are the failures worth catching
 * deterministically: a forbidden claim, a leaked placeholder, a fabricated
 * price where no pricing facts exist.
 */
export function selfQa(
  html: string,
  faqItems: FaqItem[],
  facts: BusinessFactsInput,
): string | null {
  const notes: string[] = [];
  const text = html.replace(/<[^>]+>/g, " ").toLowerCase();

  for (const claim of facts.neverClaim) {
    if (touches(text, claim)) {
      notes.push(`May touch a forbidden claim: "${claim}"`);
    }
  }

  // A concrete price with no recorded pricing logic is invention.
  if (/\$\s?\d/.test(text) && facts.pricingLogic.trim() === "") {
    notes.push(
      "Contains a dollar figure but no pricing logic is recorded in Business Facts — verify before publishing.",
    );
  }

  // No \b around the bracketed forms — a word boundary cannot match before
  // "[" or "{", which would silently let every placeholder through.
  if (/\[insert|\{\{|\[\.\.\.\]|\b(lorem ipsum|tbd|xxx)\b/i.test(text)) {
    notes.push("Contains a placeholder that must be filled in or removed.");
  }

  if (/\b(cure|heal|treats?|prevents?)\b/.test(text)) {
    notes.push("Possible health claim — review the wording.");
  }

  if (faqItems.length === 0) {
    notes.push(
      "No FAQ: no real questions were observed for this topic, so none were invented.",
    );
  }

  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 350) {
    notes.push(`Short draft (${String(words)} words) — consider expanding.`);
  }

  return notes.length > 0 ? notes.join("\n") : null;
}

/* -------------------------------------------------------------------------
 * Orchestration
 * ---------------------------------------------------------------------- */

export async function draftArticle(input: DraftInput): Promise<DraftResult> {
  const plan = await outline(input);
  const bodyRaw = await prose(input, plan);
  const body = cleanHtml(bodyRaw);

  const [faqItems, meta] = await Promise.all([
    faq(input, body),
    metadata(input, body),
  ]);

  const html = [body, faqHtml(faqItems)].filter((s) => s !== "").join("\n\n");

  return {
    html,
    ...meta,
    faq: faqItems,
    qaNotes: selfQa(html, faqItems, input.facts),
  };
}
