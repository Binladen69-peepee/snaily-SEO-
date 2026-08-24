/**
 * The shape of a method step, as the client's template renders it.
 *
 * Three parts, in this order:
 *
 *   H3        the step's written number, and nothing else - "Step One"
 *   bold ¶    the punny heading, ending in a colon
 *   plain ¶   the instruction
 *
 * Drafts used to arrive with all of it welded into the heading -
 * `### Step One - Sizzling Beginnings` - which WordPress rendered as a single
 * H3, so the pun became part of the numbering and the distinction the template
 * is built around was lost. A model can be asked for the right shape and will
 * mostly oblige; the numbering and the colon are not things worth leaving to
 * mostly, so they are rewritten here from the step's own position.
 */

const ORDINALS = [
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
  "Twenty",
];

/** "Step One" for index 0. Beyond twenty it falls back to the digit. */
export function stepLabel(index: number): string {
  const word = ORDINALS[index];
  return word === undefined ? `Step ${String(index + 1)}` : `Step ${word}`;
}

/**
 * The pun inside a step heading, with any numbering stripped off the front.
 *
 * Returns "" when the heading is nothing but its number, which is the shape
 * this module is trying to produce and so needs no second heading written
 * under it.
 */
function punFrom(headingText: string): string {
  const stripped = headingText
    .replace(/\*\*/g, "")
    .trim()
    // "Step Four - Sizzling Beginnings", "Step 4: Sizzling Beginnings"
    .replace(/^step\s+(?:\d+|[a-z]+)\s*(?:[-:.)–—]\s*)/i, "")
    // A heading that is only its number leaves nothing behind.
    .replace(/^step\s+(?:\d+|[a-z]+)\s*$/i, "")
    // Trailing separators the model sometimes leaves on a pun.
    .replace(/[\s:.–—-]+$/, "")
    .trim();

  return stripped;
}

/**
 * Renumbers the method's H3s and lifts any pun into its own bold paragraph.
 *
 * Runs over the whole method section, so the numbering comes from document
 * order rather than from whatever the model counted to. A heading that is
 * already just "Step Two" is left as one line and whatever bold paragraph the
 * model wrote beneath it is untouched.
 */
export function normaliseStepHeadings(markdown: string): string {
  let index = 0;

  return markdown.replace(/^###[ \t]+(.+?)[ \t]*$/gm, (_whole, text: string) => {
    const label = stepLabel(index);
    index += 1;

    const pun = punFrom(text);
    return pun === "" ? `### ${label}` : `### ${label}\n\n**${pun}:**`;
  });
}
