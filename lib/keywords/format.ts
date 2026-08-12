import type { SearchIntent } from "@/lib/keywords/types";

export function formatVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCpc(n: number): string {
  return `$${n.toFixed(2)}`;
}

export type DifficultyBand = {
  label: string;
  /** Text colour. */
  className: string;
  /** Progress-bar / solid fill. */
  bar: string;
  /** Tinted chip background used by score pills. */
  chip: string;
};

/**
 * KeySearch's own seven-step difficulty scale.
 *
 * Deliberately the same bands and wording as KeySearch so a score means the
 * same thing here as it does there. Every score in the app renders through
 * this, so one number always reads as one colour.
 *
 * Class names are written out in full rather than built from the band index —
 * Tailwind scans source text, so an interpolated `text-${token}` would never be
 * generated.
 */
const BANDS: (DifficultyBand & { max: number })[] = [
  {
    max: 19,
    label: "Very Easy",
    className: "text-kd-1",
    bar: "bg-kd-1",
    chip: "bg-kd-1/12 text-kd-1",
  },
  {
    max: 29,
    label: "Easy",
    className: "text-kd-2",
    bar: "bg-kd-2",
    chip: "bg-kd-2/12 text-kd-2",
  },
  {
    max: 39,
    label: "Still Easy",
    className: "text-kd-3",
    bar: "bg-kd-3",
    chip: "bg-kd-3/12 text-kd-3",
  },
  {
    max: 49,
    label: "Moderate",
    className: "text-kd-4",
    bar: "bg-kd-4",
    chip: "bg-kd-4/12 text-kd-4",
  },
  {
    max: 59,
    label: "Fairly Difficult",
    className: "text-kd-5",
    bar: "bg-kd-5",
    chip: "bg-kd-5/12 text-kd-5",
  },
  {
    max: 79,
    label: "Very Difficult",
    className: "text-kd-6",
    bar: "bg-kd-6",
    chip: "bg-kd-6/12 text-kd-6",
  },
  {
    max: 100,
    label: "Too Difficult",
    className: "text-kd-7",
    bar: "bg-kd-7",
    chip: "bg-kd-7/12 text-kd-7",
  },
];

export function difficultyBand(score: number): DifficultyBand {
  return BANDS.find((b) => score <= b.max) ?? BANDS[BANDS.length - 1]!;
}

/**
 * Bands for scores where a *high* number is good — content score, page health.
 *
 * Difficulty runs the other way, so reusing its bands would paint a content
 * score of 0 bright green and label it "Very Easy". The colours are mirrored
 * and the wording changed so the number always reads correctly.
 */
const QUALITY_BANDS: (DifficultyBand & { max: number })[] = [
  {
    max: 19,
    label: "Poor",
    className: "text-kd-7",
    bar: "bg-kd-7",
    chip: "bg-kd-7/12 text-kd-7",
  },
  {
    max: 39,
    label: "Weak",
    className: "text-kd-6",
    bar: "bg-kd-6",
    chip: "bg-kd-6/12 text-kd-6",
  },
  {
    max: 54,
    label: "Fair",
    className: "text-kd-5",
    bar: "bg-kd-5",
    chip: "bg-kd-5/12 text-kd-5",
  },
  {
    max: 69,
    label: "Decent",
    className: "text-kd-4",
    bar: "bg-kd-4",
    chip: "bg-kd-4/12 text-kd-4",
  },
  {
    max: 84,
    label: "Good",
    className: "text-kd-2",
    bar: "bg-kd-2",
    chip: "bg-kd-2/12 text-kd-2",
  },
  {
    max: 100,
    label: "Excellent",
    className: "text-kd-1",
    bar: "bg-kd-1",
    chip: "bg-kd-1/12 text-kd-1",
  },
];

export function qualityBand(score: number): DifficultyBand {
  return (
    QUALITY_BANDS.find((b) => score <= b.max) ??
    QUALITY_BANDS[QUALITY_BANDS.length - 1]!
  );
}

export const INTENT_LABEL: Record<SearchIntent, string> = {
  informational: "Info",
  commercial: "Commercial",
  transactional: "Transactional",
  navigational: "Navigational",
};

export const INTENT_VARIANT: Record<
  SearchIntent,
  "default" | "secondary" | "success" | "warning"
> = {
  informational: "secondary",
  commercial: "default",
  transactional: "success",
  navigational: "warning",
};
