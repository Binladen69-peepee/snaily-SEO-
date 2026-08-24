/**
 * The mechanics of this author's humour.
 *
 * "Make it funny" produces a model's idea of funny, which is a pun in every
 * paragraph and an exclamation mark to make sure you noticed. The client's
 * writing is funny in about ten specific, describable ways, and a model that
 * is taught the mechanism can reach for the right one and — more importantly —
 * can leave it alone when the sentence does not want it.
 *
 * Every example below is lifted verbatim from a published Cinnamon Snail post.
 * They are evidence, not stock: the prompts that carry them say so, because a
 * model handed a good line will otherwise use that line.
 */

export type Device = {
  name: string;
  /** How the device works, mechanically. */
  how: string;
  /** Real lines from the client's posts that use it. */
  examples: string[];
};

export const DEVICES: Device[] = [
  {
    name: "unexpected analogy",
    how: "Compare a cooking outcome to something from entirely outside the kitchen, chosen for how specific it is rather than how clever.",
    examples: [
      "turns your fluffy cornbread topping into something you could use to patch drywall",
      "wrapping 47 tiny corn husk parcels like an unpaid tamale elf",
    ],
  },
  {
    name: "absurd escalation",
    how: "State something ordinary, then push it one step past what the sentence needed. The extra step is the joke; a second extra step kills it.",
    examples: [
      "somewhere out there is a 75-year-old still getting kinda emotional about lunch period",
      "of course I would prefer if you rocked a whole quart of that straight out of a frilly ladies hat with a ribbon, but we can't all have our dreams come true now, can we?",
    ],
  },
  {
    name: "pop-culture reference",
    how: "Bend a film, song, band or character name around a cooking word. Works in step headings and section names. Never explained.",
    examples: ["In Queso Emergency", "Corn on the Fourth of July", "Batter Call Saul"],
  },
  {
    name: "direct dismissal",
    how: "Reject something flatly and move on. One clause, no hedging, often its own sentence.",
    examples: [
      "Cream doesn't even get an invite. Byeeee.",
      "Not messing around with some measly shreds of Daiya sprinkled on top like a Godforsaken afterthought.",
    ],
  },
  {
    name: "weird personal aside",
    how: "A parenthetical or short sentence that steps out of the recipe for a beat. About the writing or the reader, never a fabricated life event.",
    examples: ["Yep.", "I mean, I love me some vegan tamales, but this is different."],
  },
  {
    name: "punchy fragment",
    how: "A sentence with no verb, or three words long, placed after a longer one. This is the single biggest rhythm signature in the corpus.",
    examples: ["3 textures. 1 fork. Beautiful chaos.", "It's Tex-Mex comfort food royalty."],
  },
  {
    name: "contrast",
    how: "Put the good version and the bad version in one sentence so the reader feels the gap.",
    examples: [
      "It's gringo stuff, and I don't entirely mean that in a bad way.",
      "Store-bought vegan chili works perfectly fine too if you need to move faster and not do every friggin' thing from scratch.",
    ],
  },
  {
    name: "playful exaggeration",
    how: "Overstate by a wide, obviously untrue margin. Never overstate a measurement, a time or a temperature.",
    examples: [
      "then went absolutely turnt in school cafeterias across America",
      "are absolutely unhinged inside this tamale pie",
    ],
  },
  {
    name: "unusual visual image",
    how: "One concrete picture the reader can see, built from named things rather than adjectives.",
    examples: [
      "a fluffy AF golden cornbread top",
      "gooey melty cheese in the middle, meaty seitan and bean chili holding it all down",
    ],
  },
  {
    name: "self-aware comment",
    how: "Acknowledge the writing, the format or the reader's impatience from inside the post.",
    examples: [
      "You can practically smell that cornbread already and it doesn't even exist yet.",
      "Follow these step-by-step instructions for the full breakdown, or skip to the printable easy recipe card below before your imagination tortures you any further.",
    ],
  },
];

/**
 * The density rule.
 *
 * Measured against the client's own posts rather than chosen: roughly one
 * device every three or four paragraphs, clustered in the intro and thinning
 * out through the method. A model told to be funny puts one in every paragraph,
 * which reads as a comedian rather than a cook.
 */
export const DEVICE_DENSITY = `
HUMOUR IS A TOOL, NOT A QUOTA.
Reach for a device when the sentence has somewhere to go. Roughly one every
three or four paragraphs across a post, heaviest in the opening, almost absent
inside cooking instructions. A paragraph that is simply useful and plainly
written is correct and common in this author's posts.
Never signpost a joke. No "and guess what", no exclamation mark to mark the
punchline, no explaining the reference.
`.trim();

/** The device catalogue as it goes into a prompt. */
export function renderDevices(names?: string[]): string {
  const chosen =
    names === undefined
      ? DEVICES
      : DEVICES.filter((d) => names.includes(d.name));

  const lines = [
    "HOW THIS AUTHOR IS FUNNY — the mechanisms, with real lines from their posts.",
    "Study how each one works. Never reuse the words.",
    "",
  ];

  /*
   * One example each. Two was better teaching and cost about 350 tokens a
   * call, which is the difference between the opening group fitting the
   * per-minute budget and stalling the job.
   */
  for (const device of chosen) {
    lines.push(`- ${device.name}: ${device.how}`);
    const example = device.examples[0];
    if (example !== undefined) lines.push(`    e.g. "${example}"`);
  }

  lines.push("", DEVICE_DENSITY);
  return lines.join("\n");
}
