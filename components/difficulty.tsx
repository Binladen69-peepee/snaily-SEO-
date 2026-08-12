import { difficultyBand, qualityBand } from "@/lib/keywords/format";
import { cn } from "@/lib/utils";

/**
 * Which way round the number reads.
 *
 * "difficulty" — low is good (keyword difficulty, competition).
 * "quality"    — high is good (content score, page health).
 */
export type ScoreTone = "difficulty" | "quality";

function bandFor(score: number, tone: ScoreTone) {
  return tone === "quality" ? qualityBand(score) : difficultyBand(score);
}

/**
 * The circular gauge KeySearch shows above every keyword — a ring that fills
 * in proportion to the score, coloured by band.
 *
 * Drawn with an SVG stroke rather than a conic gradient so it prints and
 * renders identically everywhere.
 */
export function ScoreCircle({
  score,
  size = "lg",
  label = "Difficulty",
  tone = "difficulty",
}: {
  score: number;
  size?: "sm" | "md" | "lg";
  /** Caption under the number. Pass "" to hide it. */
  label?: string;
  tone?: ScoreTone;
}) {
  const band = bandFor(score, tone);
  const px = size === "lg" ? 132 : size === "md" ? 96 : 64;
  const stroke = size === "lg" ? 10 : size === "md" ? 8 : 6;
  const radius = (px - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(Math.max(score, 0), 100) / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: px, height: px }}>
        <svg
          width={px}
          height={px}
          viewBox={`0 0 ${String(px)} ${String(px)}`}
          className="-rotate-90"
          role="img"
          aria-label={`${label || "Score"} ${String(score)} out of 100, ${band.label}`}
        >
          <circle
            cx={px / 2}
            cy={px / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-muted"
          />
          <circle
            cx={px / 2}
            cy={px / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${String(filled)} ${String(circumference)}`}
            className={cn("transition-[stroke-dasharray] duration-700", band.className)}
            stroke="currentColor"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              "tabular font-semibold leading-none",
              band.className,
              size === "lg" ? "text-4xl" : size === "md" ? "text-2xl" : "text-lg",
            )}
          >
            {score}
          </span>
          {size !== "sm" && label !== "" && (
            <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
          )}
        </div>
      </div>

      <p className={cn("mt-2 text-sm font-medium", band.className)}>{band.label}</p>
    </div>
  );
}

/**
 * Compact score chip for table cells — a solid coloured badge with white
 * numerals, the way KeySearch prints a score.
 */
export function ScorePill({
  score,
  className,
  tone = "difficulty",
}: {
  score: number;
  className?: string;
  tone?: ScoreTone;
}) {
  const band = bandFor(score, tone);
  return (
    <span
      title={band.label}
      className={cn(
        "tabular inline-flex min-w-9 items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold text-white",
        band.bar,
        className,
      )}
    >
      {score}
    </span>
  );
}

/** Horizontal score bar, used where a circle would be too heavy. */
export function ScoreBar({
  score,
  tone = "difficulty",
}: {
  score: number;
  tone?: ScoreTone;
}) {
  const band = bandFor(score, tone);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Difficulty"
      >
        <div
          className={cn("h-full rounded-full", band.bar)}
          style={{ width: `${String(Math.min(Math.max(score, 0), 100))}%` }}
        />
      </div>
      <span className={cn("tabular text-xs font-medium", band.className)}>{score}</span>
    </div>
  );
}
