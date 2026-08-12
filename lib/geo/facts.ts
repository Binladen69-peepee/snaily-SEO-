const TEXT_KEYS = [
  "serviceArea",
  "travelPolicy",
  "eventTypes",
  "dietaryHandling",
  "pricingLogic",
  "leadTime",
  "consultingScope",
] as const;

type FactsSlice = {
  serviceArea: string;
  travelPolicy: string;
  eventTypes: string;
  dietaryHandling: string;
  pricingLogic: string;
  leadTime: string;
  consultingScope: string;
  guestMin: number | null;
  guestMax: number | null;
  pastEvents: string[];
  neverClaim: string[];
};

/** How complete the grounding record is — used as a UI chip, not a score. */
export function factsCompleteness(facts: FactsSlice): { filled: number; total: number } {
  let filled = 0;
  const total = TEXT_KEYS.length + 3;

  for (const key of TEXT_KEYS) {
    if (facts[key].trim() !== "") filled += 1;
  }
  if (facts.guestMin !== null || facts.guestMax !== null) filled += 1;
  if ((facts.pastEvents ?? []).length > 0) filled += 1;
  if ((facts.neverClaim ?? []).length > 0) filled += 1;

  return { filled, total };
}
