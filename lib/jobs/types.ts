/**
 * The shape of a Drafter generation job.
 *
 * One click produces one row here and a fixed list of stages under it. Nothing
 * in this file talks to a model or a database — it is the vocabulary the API
 * routes, the runner and the progress UI all agree on, so that a stage rename
 * is a compile error rather than a string that quietly stops matching.
 */

import type { QualityReport } from "@/lib/drafter/quality-gate";
import type { ParsedRecipe } from "@/lib/drafter/recipe-paste";
import type { DrafterResearch } from "@/lib/drafter/research";

export const JOB_STATUSES = [
  "queued",
  "running",
  "paused",
  "retrying",
  "completed",
  "failed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** Nothing more will happen to a job in one of these states on its own. */
export function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export const STAGE_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;

export type StageStatus = (typeof STAGE_STATUSES)[number];

/** A skipped stage is finished business, and the progress bar must say so. */
export function isStageDone(status: StageStatus): boolean {
  return status === "completed" || status === "skipped";
}

export const STAGE_NAMES = [
  "validate",
  "research",
  "outline",
  "sections",
  "recipe",
  "faq",
  "expand",
  "internal-links",
  "affiliate-links",
  "metadata",
  "style-qa",
  "proofread",
  "completeness",
  "assemble",
  "voice-qa",
  "save",
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

/**
 * What the author is told each stage is doing.
 *
 * Deliberately about the article, not the machinery: "Writing article", not
 * "SECTION_GENERATION_4C". The stage names are for logs and the retry API.
 */
export const STAGE_LABEL: Record<StageName, string> = {
  validate: "Understanding your recipe",
  research: "Researching search intent",
  outline: "Building the outline",
  sections: "Writing the article",
  recipe: "Building the recipe card",
  faq: "Adding FAQs",
  expand: "Filling out thin sections",
  "internal-links": "Linking your other recipes",
  "affiliate-links": "Adding ingredient links",
  metadata: "Writing the SEO details",
  "style-qa": "Applying your writing style",
  proofread: "Proofreading",
  completeness: "Final quality check",
  assemble: "Putting it together",
  "voice-qa": "Checking voice and grounding",
  save: "Saving the draft",
};

/** Sections of a Cinnamon Snail post, in publication order. */
export const SECTION_KEYS = [
  "intro",
  "why",
  "ingredients",
  "variations",
  "steps",
  "serving",
  "tips",
  "faq",
  "related",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * Where a piece of input actually came from.
 *
 * Every research input carries one. "unavailable" is a real, reportable answer
 * — the alternative is a draft written against numbers nobody can source.
 */
export type Provenance = {
  label: string;
  source: string;
  status: "real" | "unavailable";
  detail: string;
};

export type JobResearch = {
  keyword: string;
  targetWords: number;
  terms: string[];
  headings: string[];
  questions: string[];
  serpPages: number;
  /** Published posts on this site, for the internal-link stage to draw from. */
  internalPosts: { title: string; url: string }[];
  provenance: Provenance[];
  /**
   * Normalized search research (DataForSEO / SerpApi). Populated once;
   * section writers consume slices — never call providers again.
   */
  drafter?: DrafterResearch;
};

export type OutlineSection = {
  key: SectionKey;
  /** Emoji-led H2 exactly as it should appear, or "" for the unheaded intro. */
  heading: string;
  /** One line on what this section covers, fed back into the writing prompt. */
  brief: string;
  targetWords: number;
};

export type JobOutline = {
  title: string;
  sections: OutlineSection[];
  targetWords: number;
};

export type JobMetadata = {
  /** The title the author sees. Never overwritten once they have edited it. */
  workingTitle: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  excerpt: string;
  /** Real site categories, the primary one first. Empty when none matched. */
  categories?: string[];
  /** Real site tags. This site barely uses them, so usually empty. */
  tags?: string[];
  /** Names the model proposed that the site does not have, for the report. */
  rejectedTerms?: string[];
};

export type StyleFinding = {
  rule: string;
  detail: string;
  /** How many times the pattern was found. */
  count: number;
};

/**
 * Everything the pipeline has produced so far.
 *
 * Persisted on the job row after every stage. This is what makes a refresh, a
 * dead function and a provider outage all survivable: the next worker reads
 * the same object and carries on from the first thing that is missing.
 */
export type JobState = {
  version: 1;
  research?: JobResearch;
  /** Compact voice brief, computed once instead of six posts per call. */
  styleBrief?: string;
  outline?: JobOutline;
  /** Markdown per section, written once each, keyed by SectionKey. */
  sections?: Partial<Record<SectionKey, string>>;
  /** Section groups already generated, so a resumed stage skips them. */
  groupsDone?: string[];
  faq?: { question: string; answer: string }[];
  metadata?: JobMetadata;
  /** Assembled HTML, updated in place by the link, style and proof stages. */
  html?: string;
  links?: {
    internal: number;
    affiliate: number;
    unresolved: number;
    unresolvedSamples: string[];
  };
  style?: StyleFinding[];
  /**
   * Style-pass progress, so a worker that yields mid-repair resumes instead of
   * starting over. Without it the stage re-measured and re-rewrote on every
   * token-budget yield and burned sixteen calls without finishing.
   */
  styleQa?: { rewritten: string[]; done: boolean };
  /** How the finished draft scored against the author's published posts. */
  benchmark?: {
    styleMatch: number;
    genericAi: number;
    grounding: number;
    sectionCompliance: number;
    recipeAccuracy?: number;
    inventedClaims: number;
    passed: boolean;
    /** Sections the style pass rewrote. */
    rewritten: string[];
  };
  /** Final voice + grounding gate, after assembly. */
  voiceQa?: {
    voiceMatch: number;
    grounding: number;
    genericAi: number;
    sectionCompliance: number;
    recipeAccuracy: number;
    passed: boolean;
    rewritten: string[];
    issues: string[];
  };
  quality?: QualityReport;
  words?: { target: number; actual: number };
  /** Set when the expansion stage has already had its go at a thin draft. */
  expanded?: boolean;
  /** The author's recipe paste, split. Parsed, never generated. */
  parsed?: ParsedRecipe;
  /**
   * The article title when the job started.
   *
   * Kept so the save stage can tell "the author renamed this while it was
   * generating" from "nobody has touched it", and never overwrite their words
   * with the model's.
   */
  titleAtStart?: string;
  /**
   * Proofreading in flight: chunks still to do, and the ones already corrected.
   *
   * Held on the job rather than recomputed because the chunk boundaries move as
   * soon as one chunk is replaced, and a resumed proofread that re-split the
   * document would proofread across a seam it had already crossed.
   */
  proof?: { pending: string[]; done: string[] };
};

export function emptyState(): JobState {
  return { version: 1 };
}

export function parseState(value: unknown): JobState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return emptyState();
  }
  const state = value as JobState;
  return state.version === 1 ? state : emptyState();
}

/** One stage, as the progress UI sees it. No prompts, no tokens, no secrets. */
export type StageView = {
  name: StageName;
  label: string;
  status: StageStatus;
  attempt: number;
  /** "Writing section 3 of 5" while a stage is mid-flight. */
  detail: string;
  errorMessage: string | null;
  durationMs: number;
};

export type JobView = {
  id: string;
  articleId: string;
  status: JobStatus;
  stage: StageName | "";
  stages: StageView[];
  done: number;
  total: number;
  errorCode: string | null;
  errorMessage: string | null;
  /** Which stage to hand a Retry button to, when one failed. */
  failedStage: StageName | null;
  words: { target: number; actual: number } | null;
  startedAt: string | null;
  finishedAt: string | null;
};
