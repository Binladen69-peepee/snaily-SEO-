/**
 * The two things an author asks for on a draft they are already reading.
 *
 * First drafts used to live here too, as one enormous call. They now belong to
 * the staged pipeline in `lib/jobs`, because a single request cannot carry the
 * style guide, the playbook, six sample posts, a recipe and a finished article
 * inside one per-minute token allowance - which is what produced 800-word
 * "articles" and no amount of prompt work was going to fix.
 *
 * Redrafting and proofreading are different in kind: the document already
 * exists, the author is looking at it, and one bounded pass over it is the
 * whole job.
 */

import { complete } from "@/lib/ai";
import { PROOF_TASK, REDRAFT_TASK, SLANG_ALLOWLIST, STYLE_GUIDE } from "@/lib/drafter/style";

export type DraftComment = {
  id: string;
  quote: string;
  note: string;
};

function parseTitle(markdown: string): { title: string; body: string } {
  const cleaned = markdown
    .replace(/^```(?:markdown)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  const heading = /^#\s+(.+)\n+/.exec(cleaned);
  if (heading) {
    return { title: heading[1]!.trim(), body: cleaned.slice(heading[0].length) };
  }

  const titled = /^TITLE:\s*(.+)\n+/i.exec(cleaned);
  if (titled) {
    return { title: titled[1]!.trim(), body: cleaned.slice(titled[0].length) };
  }

  return { title: "", body: cleaned };
}

export async function redraftPost(input: {
  projectId: string;
  keyword: string;
  recipe: string;
  terms: string[];
  previous: string;
  current: string;
  comments: DraftComment[];
  protectedVocab?: string[];
}): Promise<string> {
  const notes =
    input.comments.length === 0
      ? "No inline comments."
      : input.comments
          .map(
            (c, i) =>
              `${String(i + 1)}. On “${c.quote.slice(0, 280)}”\n   Note: ${c.note}`,
          )
          .join("\n");

  const protectedList = (input.protectedVocab ?? []).filter((t) => t.trim() !== "");

  const user = [
    REDRAFT_TASK,
    `Target keyword: ${input.keyword}`,
    `Original recipe paste:\n${input.recipe.trim()}`,
    `Previous draft (what the model wrote last):\n${clip(input.previous, 1_500)}`,
    `Author's current document (honour their edits — do not silently revert them):\n${clip(htmlToCompact(input.current), 4_000)}`,
    `Comments (each is anchored to the quoted text; apply the note at that location):\n${notes}`,
    protectedList.length > 0
      ? `Protected vocabulary — keep these spellings exactly: ${protectedList.join(", ")}.`
      : "",
  ]
    .filter((l) => l !== "")
    .join("\n\n");

  /*
   * A leaner system prompt than the first draft gets.
   *
   * Redrafting is a revision pass: the voice, the section order and the emoji
   * headings are already in the document being revised, so re-sending the
   * section playbook and six style samples spends roughly 3,700 tokens
   * restating what the input already demonstrates. Against an 8,000-token
   * ceiling that was the difference between a redraft and a 413.
   */
  const system = [
    "You are Adam of The Cinnamon Snail, revising your own draft.",
    `Primary keyword: "${input.keyword}".`,
    STYLE_GUIDE,
  ].join("\n\n");
  const raw = await complete(
    system,
    user,
    fitMaxTokens(system, user, 4_000),
    true,
    0.6,
  );

  return parseTitle(raw).body;
}

export async function proofPost(input: {
  projectId: string;
  keyword: string;
  current: string;
  protectedVocab?: string[];
}): Promise<string> {
  const protectedList = (input.protectedVocab ?? []).filter((t) => t.trim() !== "");
  const compact = htmlToCompact(input.current);

  // Proofreading does not need the section playbook or six live posts — those
  // blow Groq's 12k TPM budget (prompt + max_tokens) on a finished article.
  const system = [
    "You are proofreading a Cinnamon Snail recipe post as Adam.",
    `Primary keyword: "${input.keyword}".`,
    `Keep this slang exactly when it already appears: ${SLANG_ALLOWLIST.join(", ")}.`,
    "Keep foreign / transliterated recipe words and diacritics. Do not Anglicise them.",
    "Do not rewrite the author's voice. Do not add or drop sections.",
  ].join("\n");

  const user = [
    PROOF_TASK,
    protectedList.length > 0
      ? `Protected vocabulary — do not “correct” these: ${protectedList.join(", ")}.`
      : "",
    `Document to proof:\n${clip(compact, 5_000)}`,
  ]
    .filter((l) => l !== "")
    .join("\n\n");

  const raw = await complete(
    system,
    user,
    fitMaxTokens(system, user, 3_500),
    true,
    0.2,
  );

  return parseTitle(raw).body;
}

/** Drop tags so a finished HTML draft does not waste Groq tokens. */
function htmlToCompact(html: string): string {
  return html
    .replace(/<img\b[^>]*>/gi, "\n[image]\n")
    .replace(/<h2\b[^>]*>/gi, "\n## ")
    .replace(/<h3\b[^>]*>/gi, "\n### ")
    .replace(/<h4\b[^>]*>/gi, "\n#### ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[2-4]|li|blockquote|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Groq on-demand llama-3.3-70b counts prompt + max_tokens against a 12k TPM
 * cap. Leave headroom so a finished post still proofs in one call.
 */
function fitMaxTokens(system: string, user: string, desired: number): number {
  // Groq counts prompt + max_tokens against one per-minute ceiling, and that
  // ceiling is per model: the retired llama-3.3-70b allowed 12,000, while
  // gpt-oss-120b allows 8,000. Overridable because the next model will differ
  // again, and a wrong value here fails every generation with a 413.
  const budget = Number(process.env.AI_TPM_BUDGET ?? "") || 7_600;
  const prompt = estimateTokens(system) + estimateTokens(user) + 24;
  return Math.max(400, Math.min(desired, budget - prompt));
}

function clip(value: string, max: number): string {
  const v = value.trim() === "" ? "(empty)" : value;
  if (v.length <= max) return v;
  return `${v.slice(0, max)}\n…[truncated]`;
}
