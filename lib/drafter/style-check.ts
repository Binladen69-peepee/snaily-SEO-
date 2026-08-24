/**
 * Reading a finished draft the way an editor would, and saying where it fails.
 *
 * The old style pass counted banned words. That catches the vocabulary and
 * misses the thing the client actually noticed: sentences that are all the same
 * length, adjectives standing in for detail, an invented memory, an ingredient
 * that is not in the recipe. Those are the failures worth a rewrite, and each
 * one is attributed to a section so the repair can be surgical.
 *
 * Everything here is deterministic. A model is used to rewrite what this finds,
 * never to decide whether there is anything to find.
 */

import {
  ALLOWED_TESTING_CLAIMS,
  INVENTED_CLAIM_MARKERS,
} from "@/lib/drafter/voice/constraints";
import { GENERIC_FOOD_ADJECTIVES, measureProse } from "@/lib/drafter/style-metrics";
import { classifyHeading, type SectionKey } from "@/lib/wordpress/sections";

export type CheckSeverity = "fail" | "warn";

export type StyleIssue = {
  /** Which section it is in, or null for the intro above the first H2. */
  section: SectionKey | null;
  rule: string;
  detail: string;
  severity: CheckSeverity;
  /** The offending text, trimmed, so a human can see what was meant. */
  evidence: string;
};

/* ---------------------------------------------------------------------------
 * Patterns
 * ------------------------------------------------------------------------ */

/** Sentence openings that mark writing assembled rather than written. */
const AI_OPENINGS = [
  "when it comes to",
  "whether you're",
  "whether you are",
  "look no further",
  "in today's world",
  "let's dive in",
  "let's be honest",
  "picture this",
  "imagine ",
  "there's something about",
  "there is something about",
  "if you're anything like",
  "we all know",
  "say goodbye to",
  "gone are the days",
  "at the end of the day",
  "the secret to",
  "trust me when i say",
];

/** Phrases the style guide bans outright, plus their obvious inflections. */
const CLICHES = [
  "hits all the right notes",
  "checks all the right boxes",
  "game changer",
  "game-changer",
  "next level",
  "next-level",
  "takes it to the next level",
  "melt in your mouth",
  "melt-in-your-mouth",
  "burst of flavor",
  "burst of flavour",
  "symphony of",
  "medley of",
  "perfect blend",
  "labour of love",
  "labor of love",
  "crowd pleaser",
  "crowd-pleaser",
  "weeknight hero",
  "flavor bomb",
  "flavour bomb",
  "warm hug",
  "like a warm hug",
  "food coma",
  "guilt free",
  "guilt-free",
  "every single time",
  "and guess what",
  "cozy bowl",
  "feel good about the planet",
  "brightens the plate",
];

/**
 * One hit is enough. These are the filler metaphors the client named.
 * Stacked "silky/velvety/cozy" still goes through the adjective counter;
 * these never belong in this author's posts.
 */
const MAJOR_GENERIC_METAPHORS = [
  "like a warm hug",
  "warm hug",
  "cozy bowl",
  "feel good about the planet",
  "feel good about the",
  "brightens the plate",
  "hug from an",
  "pause briefly to admire",
  "the aroma will shift",
  "the foundation is set",
];

/**
 * Distinctive nouns from the style-example corpus.
 *
 * A Tamale Pie excerpt in STYLE_CONTEXT must not leak into a mushroom
 * stroganoff. If the current recipe actually contains the term, it is allowed.
 */
const STYLE_EXAMPLE_LEAK_TERMS = [
  "masa harina",
  "tamale pie",
  "tamale elf",
  "cornbread topping",
  "vegan queso",
  "hatch chile",
  "young green jackfruit",
  "bánh mì",
  "bò kho",
  "bo kho",
];

/**
 * Ingredients a model reaches for because the dish "usually" has them.
 *
 * Checked against the recipe rather than banned: coconut milk in a coconut
 * soup is correct, and coconut milk in a sour-cream soup is the exact failure
 * the client described. High-signal items only, so a hit is nearly always real.
 */
const COMMONLY_HALLUCINATED = [
  "coconut milk",
  "coconut cream",
  "heavy cream",
  "double cream",
  "sour cream",
  "cream cheese",
  "white wine",
  "red wine",
  "butter",
  "eggs",
  "egg",
  "honey",
  "parmesan",
  "cheddar",
  "milk",
  "yogurt",
  "yoghurt",
  "buttermilk",
  "chicken stock",
  "beef stock",
  "fish sauce",
  "bacon",
  "gelatin",
  "gelatine",
];

/** Claims about reception or scale that need a source. */
const UNSOURCED_CLAIM = [
  /\b\d[\d,]*\s+(?:recipe\s+)?testers?\b/i,
  /\bmost popular\b/i,
  /\bbest[- ]selling\b/i,
  /\bwent viral\b/i,
  /\baward[- ]winning\b/i,
  /\bfeatured in\b/i,
  /\bthousands of (?:readers|people|cooks)\b/i,
];

/* ---------------------------------------------------------------------------
 * Splitting a document into its sections
 * ------------------------------------------------------------------------ */

export type DocSection = { key: SectionKey | null; heading: string; html: string };

export function splitSections(html: string): DocSection[] {
  const parts = html.split(/(?=<h2\b)/i).filter((p) => p.trim() !== "");
  const out: DocSection[] = [];

  for (const part of parts) {
    const m = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(part);
    const heading = (m?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    out.push({
      key: heading === "" ? null : classifyHeading(heading),
      heading,
      html: part,
    });
  }

  return out;
}

function textOf(html: string): string {
  return html
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#\d+;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const trim = (t: string, n = 110) => (t.length <= n ? t : `${t.slice(0, n)}…`);

/* ---------------------------------------------------------------------------
 * The checks
 * ------------------------------------------------------------------------ */

export type CheckInput = {
  html: string;
  /** Ingredient lines from the author's recipe, verbatim. */
  recipeIngredients: string[];
  /**
   * Title, keyword and method as well as ingredients.
   *
   * Leak-term checks use this so a tamale-pie post may say "masa harina"
   * while a stroganoff post may not, even though STYLE_CONTEXT examples do.
   */
  recipeText?: string;
};

export function checkStyle(input: CheckInput): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const recipeText = (
    input.recipeText ?? input.recipeIngredients.join(" ")
  ).toLowerCase();

  for (const section of splitSections(input.html)) {
    const text = textOf(section.html);
    const add = (
      rule: string,
      detail: string,
      evidence: string,
      severity: CheckSeverity = "fail",
    ) => {
      issues.push({ section: section.key, rule, detail, severity, evidence });
    };

    if (
      /<<<[^>]*>>>/.test(section.html) ||
      /<<<\s*(?:SECTION:|END)/i.test(text) ||
      /&lt;&lt;&lt;/.test(section.html)
    ) {
      add(
        "pipeline marker",
        "Internal stage delimiter leaked into the article",
        trim(text.match(/<<<[^>]*>>>/)?.[0] ?? text.match(/&lt;&lt;&lt;[^&]*&gt;&gt;&gt;/)?.[0] ?? "<<<…>>>"),
      );
    }

    if (words(text) < 12) continue;

    const lower = text.toLowerCase();
    const sents = sentences(text);
    const metrics = measureProse(section.html);

    /* ---- Invented biography ---------------------------------------- */
    for (const marker of INVENTED_CLAIM_MARKERS) {
      const at = lower.indexOf(marker);
      if (at === -1) continue;
      const sentence = sents.find((s) => s.toLowerCase().includes(marker)) ?? "";
      add(
        "invented claim",
        `Reads as a personal memory: "${marker}"`,
        trim(sentence),
      );
    }

    for (const pattern of UNSOURCED_CLAIM) {
      const m = pattern.exec(text);
      if (m === null) continue;
      // The site's own testing wording is documented and allowed.
      const sentence = sents.find((s) => pattern.test(s)) ?? "";
      if (ALLOWED_TESTING_CLAIMS.some((a) => sentence.toLowerCase().includes(a))) {
        continue;
      }
      add("invented claim", `Unsourced claim: "${m[0]}"`, trim(sentence));
    }

    const geo = /\bfrom [A-Z][a-z]+ to [A-Z][a-z]+\b/.exec(text);
    if (geo !== null) {
      const sentence = sents.find((s) => s.includes(geo[0]!)) ?? "";
      add(
        "invented claim",
        `Invented geography: "${geo[0]}"`,
        trim(sentence),
      );
    }

    /* ---- Grounding -------------------------------------------------- */
    for (const ingredient of COMMONLY_HALLUCINATED) {
      const used = new RegExp(`\\b${ingredient}\\b`, "i").test(text);
      if (!used) continue;
      if (recipeText.includes(ingredient)) continue;

      // "no butter", "without eggs" are about its absence, which is fine.
      const sentence = sents.find((s) => new RegExp(`\\b${ingredient}\\b`, "i").test(s)) ?? "";
      if (/\b(no|without|skip|instead of|free of|never|isn't|is not|doesn't|does not)\b/i.test(sentence)) {
        continue;
      }
      if (new RegExp(`\\b${ingredient}[- ]free\\b`, "i").test(sentence)) {
        continue;
      }
      add(
        "ungrounded ingredient",
        `"${ingredient}" is not in this recipe`,
        trim(sentence),
      );
    }

    for (const term of STYLE_EXAMPLE_LEAK_TERMS) {
      if (!lower.includes(term)) continue;
      if (recipeText.includes(term)) continue;
      const sentence = sents.find((s) => s.toLowerCase().includes(term)) ?? "";
      add(
        "style leak",
        `"${term}" belongs to a style example, not this recipe`,
        trim(sentence),
      );
    }

    /* ---- Generic writing -------------------------------------------- */
    for (const opening of AI_OPENINGS) {
      const hit = sents.find((s) => s.toLowerCase().startsWith(opening));
      if (hit === undefined) continue;
      add("generic opening", `Opens with "${opening}"`, trim(hit));
    }

    for (const cliche of CLICHES) {
      if (!lower.includes(cliche)) continue;
      const sentence = sents.find((s) => s.toLowerCase().includes(cliche)) ?? "";
      add("cliche", `"${cliche}"`, trim(sentence));
    }

    for (const metaphor of MAJOR_GENERIC_METAPHORS) {
      if (!lower.includes(metaphor)) continue;
      const sentence = sents.find((s) => s.toLowerCase().includes(metaphor)) ?? "";
      add("generic metaphor", `"${metaphor}"`, trim(sentence));
    }

    const genericHits = GENERIC_FOOD_ADJECTIVES.filter((a) => lower.includes(a));
    if (genericHits.length >= 2) {
      add(
        "filler adjectives",
        `${String(genericHits.length)} generic descriptors: ${genericHits.slice(0, 4).join(", ")}`,
        trim(sents.find((s) => genericHits.some((g) => s.toLowerCase().includes(g))) ?? ""),
      );
    }

    /* ---- Rhythm ------------------------------------------------------ */
    if (metrics.sentences >= 6) {
      if (metrics.meanSentenceWords > 21) {
        add(
          "sentence rhythm",
          `Sentences average ${String(metrics.meanSentenceWords)} words; this author runs about 16`,
          trim(sents.find((s) => words(s) > 28) ?? sents[0] ?? ""),
          "warn",
        );
      }
      if (metrics.shortSentenceShare < 0.12) {
        add(
          "sentence rhythm",
          `Only ${String(Math.round(metrics.shortSentenceShare * 100))}% of sentences are short; this author runs about 27%`,
          trim(sents[0] ?? ""),
          "warn",
        );
      }

      // Three sentences in a row opening the same way reads as a template.
      const openings = sents.map((s) => (/^[\w'’]+/.exec(s)?.[0] ?? "").toLowerCase());
      for (let i = 0; i + 2 < openings.length; i += 1) {
        if (
          openings[i] !== "" &&
          openings[i] === openings[i + 1] &&
          openings[i] === openings[i + 2]
        ) {
          add(
            "repetitive structure",
            `Three sentences in a row open with "${openings[i]!}"`,
            trim(sents[i] ?? ""),
            "warn",
          );
          break;
        }
      }
    }

    /* ---- Personality ------------------------------------------------- */
    if (
      words(text) > 180 &&
      metrics.parentheticals === 0 &&
      metrics.firstPerson === 0 &&
      metrics.slang === 0 &&
      section.key !== "how-to-make"
    ) {
      add(
        "missing personality",
        "No aside, no first person and no house slang in a long section",
        trim(sents[0] ?? ""),
        "warn",
      );
    }

    if (metrics.exclamations > 4) {
      add(
        "over-written",
        `${String(metrics.exclamations)} exclamation marks per 1,000 words; this author runs under 1`,
        trim(sents.find((s) => s.includes("!")) ?? ""),
        "warn",
      );
    }
    if (metrics.slang > 14) {
      add(
        "over-written",
        "House slang is laid on far thicker than the published posts",
        trim(sents[0] ?? ""),
        "warn",
      );
    }

    if (section.key === "how-to-make") {
      for (const sent of sents) {
        if (words(sent) <= 55) continue;
        add(
          "step fluff",
          "A step instruction ran well past 1-3 sentences",
          trim(sent),
          "warn",
        );
      }
    }
  }

  if (/<<<[^>]*>>>/.test(input.html) && !issues.some((i) => i.rule === "pipeline marker")) {
    issues.push({
      section: null,
      rule: "pipeline marker",
      detail: "Internal stage delimiter leaked into the article",
      severity: "fail",
      evidence: "<<<…>>>",
    });
  }

  return issues;
}

/** Failures that must not ship. A rewrite that cannot clear these fails the job. */
export const HARD_FAIL_RULES = [
  "invented claim",
  "ungrounded ingredient",
  "pipeline marker",
  "style leak",
  "generic metaphor",
] as const;

export function hardFailIssues(issues: StyleIssue[]): StyleIssue[] {
  const rules = new Set<string>(HARD_FAIL_RULES);
  return issues.filter((i) => i.severity === "fail" && rules.has(i.rule));
}

/** Only the sections that need rewriting, worst first. */
export function failingSections(issues: StyleIssue[]): (SectionKey | null)[] {
  const weight = new Map<SectionKey | null, number>();

  for (const issue of issues) {
    const points = issue.severity === "fail" ? 3 : 1;
    weight.set(issue.section, (weight.get(issue.section) ?? 0) + points);
  }

  return [...weight.entries()]
    .filter(([, score]) => score >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([section]) => section);
}
