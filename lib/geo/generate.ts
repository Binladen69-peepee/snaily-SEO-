import { complete } from "@/lib/ai";
import {
  categoryRubric,
  momentRubric,
  type AnchorPage,
} from "@/lib/geo/config";
import {
  findDuplicate,
  type ExistingPost,
} from "@/lib/geo/redundancy";
import type { RawSignal } from "@/lib/geo/signals";

/**
 * Moment mapping.
 *
 * Not keyword clustering: the seed plus real demand signal plus the business's
 * own attributes are turned into article ideas that each sit at the
 * intersection of one moment and one trust category. The spec's whole argument
 * is that this intersection is what makes a piece specific enough to be cited.
 *
 * The model classifies and phrases; it does not supply facts. Attributes come
 * from Business Facts, and anything it cannot ground it must leave out.
 */

export type BusinessFactsInput = {
  serviceArea: string;
  travelPolicy: string;
  eventTypes: string;
  guestMin: number | null;
  guestMax: number | null;
  dietaryHandling: string;
  pricingLogic: string;
  leadTime: string;
  consultingScope: string;
  pastEvents: string[];
  neverClaim: string[];
};

export type GeneratedIdea = {
  title: string;
  moment: string;
  category: string;
  rationale: string;
  attributes: string[];
  anchorText: string;
  redundantWith: string | null;
};

/** Only these ids may come back; anything else is dropped. */
const MOMENT_IDS = ["want_to_know", "want_to_go", "want_to_do", "want_to_buy"];
const CATEGORY_IDS = [
  "pricing",
  "problems",
  "not_a_fit",
  "comparison",
  "how_to",
  "local_logistics",
];

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
      `Guest counts: ${f.guestMin === null ? "no minimum" : `min ${String(f.guestMin)}`}, ${
        f.guestMax === null ? "no maximum" : `max ${String(f.guestMax)}`
      }`,
    );
  }
  add("Dietary handling", f.dietaryHandling);
  add("Pricing logic", f.pricingLogic);
  add("Booking / lead time", f.leadTime);
  add("Consulting scope", f.consultingScope);
  if (f.pastEvents.length > 0) {
    lines.push(`Past events that may be referenced generally:\n- ${f.pastEvents.join("\n- ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "(none recorded yet)";
}

function systemPrompt(f: BusinessFactsInput): string {
  return [
    "You map real search moments to supporting article ideas for a local business.",
    "",
    "You are NOT clustering keywords. Three near-duplicate keywords must never become three articles.",
    "",
    "Classify every idea against these moment definitions. Use them exactly as written; do not reinterpret them:",
    momentRubric(),
    "",
    "Give every idea exactly one trust-content category:",
    categoryRubric(),
    "",
    "Hard rules:",
    "Titles are real questions or situations a person would type, never keyword phrases.",
    "Never produce two ideas that differ only by a place name. No city-swap templating, ever.",
    "Spread ideas across all four moments and across at least four different categories.",
    "Build each idea around a concrete attribute (guest count band, event type, dietary mix, region, lead time).",
    "Use ONLY the business facts supplied. Never invent a price, a service area, a policy, a statistic or an availability promise.",
    "Never make a health claim.",
    f.neverClaim.length > 0
      ? `- The business has explicitly forbidden these claims: ${f.neverClaim.join("; ")}`
      : "",
    "",
    "Business facts (the only facts you may rely on):",
    factsBlock(f),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

type ModelIdea = {
  title?: string;
  moment?: string;
  category?: string;
  rationale?: string;
  attributes?: string[];
  anchorText?: string;
};

/** Pulls the JSON array out of a model response that may be fenced or prefaced. */
function parseIdeas(raw: string): ModelIdea[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];

  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as ModelIdea[]) : [];
  } catch {
    return [];
  }
}

export async function mapMoments(input: {
  seed: string;
  anchor: AnchorPage;
  facts: BusinessFactsInput;
  signals: RawSignal[];
  published: ExistingPost[];
}): Promise<GeneratedIdea[]> {
  const { seed, anchor, facts, signals, published } = input;

  const signalBlock =
    signals.length === 0
      ? "(no live signal available — rely on the business facts and the seed topic)"
      : signals
          .slice(0, 40)
          .map((s) => {
            const tag =
              s.source === "paa"
                ? "People Also Ask"
                : s.source === "related"
                  ? "Related search"
                  : `Search Console${s.impressions ? ` · ${String(s.impressions)} impressions` : ""}`;
            return `- ${s.phrase}  [${tag}]`;
          })
          .join("\n");

  const existingBlock =
    published.length === 0
      ? "(none found)"
      : published
          .slice(0, 60)
          .map((p) => `- ${p.title}`)
          .join("\n");

  const user = [
    `Seed topic: ${seed}`,
    `Anchor page these should support: ${anchor.label}`,
    "",
    "Real demand signal observed for this topic:",
    signalBlock,
    "",
    "Articles already published on this blog — never suggest anything close to these:",
    existingBlock,
    "",
    "Return 8–15 ideas as a JSON array. Each object:",
    '{ "title": string, "moment": one of ' +
      MOMENT_IDS.join("|") +
      ', "category": one of ' +
      CATEGORY_IDS.join("|") +
      ', "rationale": one sentence on why this gets cited, "attributes": string[], "anchorText": natural-language link text pointing at the anchor page }',
    "",
    "Return only the JSON array.",
  ].join("\n");

  const raw = await complete(systemPrompt(facts), user, 3000);
  const parsed = parseIdeas(raw);

  const out: GeneratedIdea[] = [];
  const accepted: string[] = [];

  for (const idea of parsed) {
    const title = (idea.title ?? "").trim();
    if (title === "") continue;

    const moment = MOMENT_IDS.includes(idea.moment ?? "")
      ? idea.moment!
      : "want_to_know";
    const category = CATEGORY_IDS.includes(idea.category ?? "")
      ? idea.category!
      : "how_to";

    // Redundancy is enforced here rather than trusted to the model: it is
    // checked against published posts and against siblings already accepted.
    const duplicate = findDuplicate(title, published, accepted);

    out.push({
      title,
      moment,
      category,
      rationale: (idea.rationale ?? "").trim(),
      attributes: Array.isArray(idea.attributes)
        ? idea.attributes.filter((a) => typeof a === "string").slice(0, 6)
        : [],
      anchorText: (idea.anchorText ?? anchor.label).trim(),
      redundantWith: duplicate,
    });

    if (duplicate === null) accepted.push(title);
    if (out.length >= 15) break;
  }

  return out;
}
