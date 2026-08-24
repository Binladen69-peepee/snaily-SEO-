/** The pipeline, in order. One entry per stage name, checked by the compiler. */

import type { StageImpl } from "@/lib/jobs/context";
import type { StageName } from "@/lib/jobs/types";
import {
  expand,
  faq,
  outline,
  recipe,
  research,
  sections,
  validate,
} from "@/lib/jobs/stages/generation";
import {
  affiliateLinks,
  assemble,
  completeness,
  internalLinks,
  metadata,
  proofread,
  save,
  styleQa,
  voiceQa,
} from "@/lib/jobs/stages/finishing";

export const STAGES: Record<StageName, StageImpl> = {
  validate,
  research,
  outline,
  sections,
  recipe,
  faq,
  expand,
  "internal-links": internalLinks,
  "affiliate-links": affiliateLinks,
  metadata,
  "style-qa": styleQa,
  proofread,
  completeness,
  assemble,
  "voice-qa": voiceQa,
  save,
};
