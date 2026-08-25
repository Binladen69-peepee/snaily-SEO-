/**
 * Four labeled buckets for every Drafter prompt.
 *
 * The failure this exists to stop: a model handed a Tamale Pie excerpt as a
 * style example treats masa harina, coconut milk, or "testers in Portland" as
 * facts about the recipe it is writing. Style examples are not source material.
 * These wrappers say so in the imperative, at the edges of the text, so a call
 * cannot quietly mix them.
 */

export function styleContext(blocks: Array<string | undefined | null>): string {
  const body = blocks
    .map((b) => (b ?? "").trim())
    .filter((b) => b !== "")
    .join("\n\n");
  if (body === "") return "";

  return [
    "===== STYLE_CONTEXT =====",
    "STYLE ONLY. Rhythm, jokes, sentence shape, formatting, banned words.",
    "Nothing in this bucket is a fact about the recipe you are writing now.",
    "Do not copy ingredients, methods, substitutions, dish names, tester stories,",
    "or any other claim from these examples into the current article.",
    "A training example about tamale pie, chili, queso, wine, or coconut milk is",
    "not true of this recipe unless RECIPE_CONTEXT says so.",
    "",
    body,
    "===== END STYLE_CONTEXT =====",
  ].join("\n");
}

export function recipeContext(input: {
  title?: string;
  keyword?: string;
  ingredients?: string;
  steps?: string;
  notes?: string;
}): string {
  const lines = [
    "===== RECIPE_CONTEXT =====",
    "The ONLY source of truth about this recipe.",
    "Every ingredient, quantity, time and temperature you mention must appear here.",
    "If it is not here, it does not exist. Do not add coconut milk, wine, or any",
    "other 'usual' ingredient because the dish typically has one.",
    "Substitutions are allowed only when they are written here.",
  ];
  if (input.title) lines.push("", `Working title: ${input.title}`);
  if (input.keyword) lines.push(`Primary keyword: ${input.keyword}`);
  if (input.ingredients) lines.push("", "Ingredients:", input.ingredients);
  if (input.steps) lines.push("", "Method:", input.steps);
  if (input.notes) lines.push("", input.notes);
  lines.push("===== END RECIPE_CONTEXT =====");
  return lines.join("\n");
}

export function researchContext(input: {
  terms?: string[];
  questions?: string[];
  headings?: string[];
  intent?: string;
  titleTerms?: string[];
  note?: string;
  provider?: string;
}): string {
  const terms = (input.terms ?? []).filter((t) => t.trim() !== "");
  const questions = (input.questions ?? []).filter((q) => q.trim() !== "");
  const headings = (input.headings ?? []).filter((h) => h.trim() !== "");
  const titleTerms = (input.titleTerms ?? []).filter((t) => t.trim() !== "");
  const intent = (input.intent ?? "").trim();
  if (
    terms.length === 0 &&
    questions.length === 0 &&
    headings.length === 0 &&
    titleTerms.length === 0 &&
    intent === ""
  ) {
    return "";
  }

  const lines = [
    "===== RESEARCH_CONTEXT =====",
    "Search / competitive evidence for THIS keyword only. Not facts about the recipe.",
    "Competitor pages and People Also Ask are topic signals — never import their",
    "ingredients, methods, or claims into this article.",
    "Use a term or question only where it fits. Never invent a search phrase.",
  ];
  if (input.provider) {
    lines.push(`Source: ${input.provider}`);
  }
  if (intent !== "") {
    lines.push(`Search intent (inferred): ${intent}`);
  }
  if (input.note) {
    lines.push(input.note);
  }
  if (terms.length > 0) {
    lines.push("", "Related search terms:", terms.map((t) => `- ${t}`).join("\n"));
  }
  if (titleTerms.length > 0) {
    lines.push(
      "",
      "Recurring terms in top SERP titles (for natural coverage, not stuffing):",
      titleTerms.map((t) => `- ${t}`).join("\n"),
    );
  }
  if (questions.length > 0) {
    lines.push("", "Questions readers search:", questions.map((q) => `- ${q}`).join("\n"));
  }
  if (headings.length > 0) {
    lines.push(
      "",
      "Competitor titles / coverage (for gaps — do not copy outlines):",
      headings.map((h) => `- ${h}`).join("\n"),
    );
  }
  lines.push("===== END RESEARCH_CONTEXT =====");
  return lines.join("\n");
}

export function siteContext(posts: Array<{ title: string; url?: string }>): string {
  const titles = posts.map((p) => p.title.trim()).filter((t) => t !== "");
  if (titles.length === 0) return "";

  return [
    "===== SITE_CONTEXT =====",
    "Verified published recipes on this site. You may name these, and only these.",
    "Write them the way you would say them in a sentence. Never invent a title.",
    "Never describe a recipe you cannot see in this list.",
    "",
    ...titles.map((t) => `- ${t}`),
    "===== END SITE_CONTEXT =====",
  ].join("\n");
}

/**
 * The three fact buckets, joined. Style never goes in here.
 *
 * Callers put this in the user message and keep STYLE_CONTEXT in the system
 * message, so a training excerpt cannot sit next to the live ingredient list.
 */
export function factBuckets(input: {
  title?: string;
  keyword?: string;
  ingredients?: string;
  steps?: string;
  notes?: string;
  terms?: string[];
  questions?: string[];
  headings?: string[];
  intent?: string;
  titleTerms?: string[];
  researchNote?: string;
  researchProvider?: string;
  posts?: Array<{ title: string; url?: string }>;
}): string {
  return [
    recipeContext({
      title: input.title,
      keyword: input.keyword,
      ingredients: input.ingredients,
      steps: input.steps,
      notes: input.notes,
    }),
    researchContext({
      terms: input.terms,
      questions: input.questions,
      headings: input.headings,
      intent: input.intent,
      titleTerms: input.titleTerms,
      note: input.researchNote,
      provider: input.researchProvider,
    }),
    siteContext(input.posts ?? []),
  ]
    .filter((b) => b !== "")
    .join("\n\n");
}
